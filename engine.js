// Slow Boil path engine. Works in the browser (window.SlowBoil) and in Node (module.exports).
// `api(path)` must resolve to parsed Deezer JSON for e.g. "/artist/399/related".
(function (root) {
  function makeEngine(api, opts) {
    opts = opts || {};
    const MAX_FETCH = opts.maxFetch || 260;
    const BEAM = opts.beam || 18;          // nodes expanded per level per side
    const MAX_DEPTH = opts.maxDepth || 7;  // levels per side
    const relCache = new Map();
    let fetches = 0;

    const lf = a => Math.log10(((a && a.nb_fan) || 0) + 1);
    const slim = a => ({ id: a.id, name: a.name, nb_fan: a.nb_fan || 0, link: a.link, picture: a.picture_medium || a.picture });

    async function findArtist(q) {
      const r = await api(`/search/artist?q=${encodeURIComponent(q)}&limit=10`);
      const list = (r && r.data) || [];
      if (!list.length) return null;
      const nq = norm(q);
      const exact = list.filter(a => norm(a.name) === nq).sort((x, y) => (y.nb_fan || 0) - (x.nb_fan || 0));
      return slim(exact[0] || list[0]);
    }

    async function related(id) {
      if (relCache.has(id)) return relCache.get(id);
      if (fetches >= MAX_FETCH) return [];
      fetches++;
      const r = await api(`/artist/${id}/related?limit=25`);
      const list = ((r && r.data) || []).map(slim);
      relCache.set(id, list);
      return list;
    }

    // Bidirectional beam search. Prefers bridges whose popularity sits between the endpoints.
    async function findPath(A, B, exclude, onProgress) {
      exclude = new Set((exclude || []).map(Number));
      exclude.delete(A.id); exclude.delete(B.id);
      if (A.id === B.id) return [A];
      const lo = Math.min(lf(A), lf(B)), hi = Math.max(lf(A), lf(B));
      const off = a => { const v = lf(a); return v < lo ? lo - v : v > hi ? v - hi : 0; };

      const side = [
        { par: new Map([[A.id, null]]), node: new Map([[A.id, A]]), depth: new Map([[A.id, 0]]), front: [A] },
        { par: new Map([[B.id, null]]), node: new Map([[B.id, B]]), depth: new Map([[B.id, 0]]), front: [B] },
      ];
      fetches = 0;

      for (let level = 0; level < MAX_DEPTH * 2; level++) {
        const s = side[0].front.length <= side[1].front.length ? 0 : 1;
        const me = side[s], other = side[1 - s];
        if (!me.front.length) break;
        const next = [];
        const meets = [];
        const toExpand = me.front.slice(0, BEAM);
        for (let k = 0; k < toExpand.length && fetches < MAX_FETCH; k += 6) {
          const batch = toExpand.slice(k, k + 6);
          const results = await Promise.all(batch.map(n => related(n.id).catch(() => [])));
          batch.forEach((n, j) => {
            for (const m of results[j]) {
              if (exclude.has(m.id)) continue;
              if (!me.par.has(m.id)) {
                me.par.set(m.id, n.id); me.node.set(m.id, m); me.depth.set(m.id, me.depth.get(n.id) + 1);
                next.push(m);
              }
              if (other.par.has(m.id)) meets.push(m.id);
            }
          });
          if (onProgress) onProgress({ fetches, max: MAX_FETCH, at: batch[batch.length - 1].name });
          if (meets.length) break;
        }
        // also: a node in the other side may list one of ours, handled when it expands.
        if (meets.length) {
          let best = null, bestCost = Infinity;
          for (const id of new Set(meets)) {
            const p = stitch(side, id);
            const cost = p.length * 0.35 + p.slice(1, -1).reduce((t, a) => t + off(a), 0);
            if (cost < bestCost) { bestCost = cost; best = p; }
          }
          return best;
        }
        next.sort((x, y) => off(x) - off(y));
        me.front = next;
        if (fetches >= MAX_FETCH) break;
      }
      return null;
    }

    function stitch(side, meetId) {
      const left = [], right = [];
      for (let id = meetId; id != null; id = side[0].par.get(id)) left.unshift(side[0].node.get(id) || side[1].node.get(id));
      for (let id = side[1].par.get(meetId); id != null; id = side[1].par.get(id)) right.push(side[1].node.get(id));
      return left.concat(right);
    }

    // One well-known track per artist; among each artist's top few, choose the one whose
    // Deezer rank is closest to the previous pick so popularity moves smoothly.
    async function pickTracks(path) {
      const tops = await Promise.all(path.map(a => api(`/artist/${a.id}/top?limit=5`).then(r => (r && r.data) || []).catch(() => [])));
      const out = [];
      let prevRank = null;
      const seen = new Set();
      tops.forEach((list, i) => {
        const cands = list.filter(t => t.readable !== false && !seen.has(norm(t.title_short || t.title))).slice(0, 3);
        let t = cands[0];
        if (prevRank != null && cands.length > 1) {
          t = cands.reduce((b, c) => Math.abs(Math.log(c.rank || 1) - Math.log(prevRank)) < Math.abs(Math.log(b.rank || 1) - Math.log(prevRank)) ? c : b);
          if (t !== cands[0] && (cands[0].rank || 0) > (t.rank || 0) * 3) t = cands[0];
        }
        if (t) { prevRank = t.rank || prevRank; seen.add(norm(t.title_short || t.title)); }
        out.push({
          artist: path[i],
          track: t ? { id: t.id, title: t.title_short || t.title, full: t.title, preview: t.preview, link: t.link, duration: t.duration, album: t.album && t.album.title, cover: t.album && t.album.cover_medium } : null,
        });
      });
      return out;
    }

    return { findArtist, findPath, pickTracks, stats: () => ({ fetches }) };
  }

  function norm(s) { return String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/^the\s+/, "").replace(/[^a-z0-9]/g, ""); }

  const SlowBoil = { makeEngine, norm };
  if (typeof module !== "undefined" && module.exports) module.exports = SlowBoil;
  else root.SlowBoil = SlowBoil;
})(this);
