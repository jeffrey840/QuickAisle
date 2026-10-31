export interface Xy {
  x: number;
  y: number;
}

interface Adj {
  to: string;
  len: number;
}

/** Simple undirected weighted graph with Dijkstra. */
export class StoreGraph {
  readonly xy = new Map<string, Xy>();
  private readonly adj = new Map<string, Adj[]>();

  addNode(id: string, x: number, y: number): void {
    this.xy.set(id, { x, y });
    if (!this.adj.has(id)) this.adj.set(id, []);
  }

  addEdge(a: string, b: string, len: number): void {
    if (!this.adj.has(a)) this.adj.set(a, []);
    if (!this.adj.has(b)) this.adj.set(b, []);
    this.adj.get(a)!.push({ to: b, len });
    this.adj.get(b)!.push({ to: a, len });
  }

  neighbors(id: string): Adj[] {
    return this.adj.get(id) ?? [];
  }

  dijkstra(from: string): { dist: Map<string, number>; prev: Map<string, string | null> } {
    const dist = new Map<string, number>();
    const prev = new Map<string, string | null>();
    const visited = new Set<string>();
    // binary heap keyed by distance
    const heap: Array<{ id: string; d: number }> = [];
    const push = (id: string, d: number) => {
      heap.push({ id, d });
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p]!.d <= heap[i]!.d) break;
        [heap[p], heap[i]] = [heap[i]!, heap[p]!];
        i = p;
      }
    };
    const pop = (): { id: string; d: number } | undefined => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length > 0 && last) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = 2 * i + 2;
          let m = i;
          if (l < heap.length && heap[l]!.d < heap[m]!.d) m = l;
          if (r < heap.length && heap[r]!.d < heap[m]!.d) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i]!, heap[m]!];
          i = m;
        }
      }
      return top;
    };

    dist.set(from, 0);
    prev.set(from, null);
    push(from, 0);
    for (;;) {
      const cur = pop();
      if (!cur) break;
      if (visited.has(cur.id)) continue;
      visited.add(cur.id);
      for (const e of this.neighbors(cur.id)) {
        const nd = cur.d + e.len;
        if (nd < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, nd);
          prev.set(e.to, cur.id);
          push(e.to, nd);
        }
      }
    }
    return { dist, prev };
  }

  /** Node-id path (inclusive) from `from` to `to` using a prev map from dijkstra(from). */
  static chain(prev: Map<string, string | null>, from: string, to: string): string[] {
    const path: string[] = [];
    let cur: string | null | undefined = to;
    while (cur !== null && cur !== undefined) {
      path.push(cur);
      if (cur === from) break;
      cur = prev.get(cur);
    }
    path.reverse();
    return path[0] === from ? path : [];
  }
}
