/**
 * Binary max-heap keyed by rank.
 *
 * Used to hold a party's currently accepted seekers so that the worst-ranked member
 * (the eviction candidate) is available in O(1) and removal is O(log q).
 *
 * "Worst" means the LARGEST rank value, since rank 0 is the most preferred — hence
 * a max-heap rather than a min-heap.
 */
export class MaxHeap {
  #items = [];

  get size() {
    return this.#items.length;
  }

  /** The worst-ranked member, or undefined when empty. */
  peek() {
    return this.#items[0];
  }

  push(id, rank) {
    this.#items.push({ id, rank });
    this.#siftUp(this.#items.length - 1);
  }

  /** Remove and return the worst-ranked member. */
  pop() {
    if (this.#items.length === 0) return undefined;
    const top = this.#items[0];
    const last = this.#items.pop();
    if (this.#items.length > 0) {
      this.#items[0] = last;
      this.#siftDown(0);
    }
    return top;
  }

  ids() {
    return this.#items.map((item) => item.id);
  }

  /** Members in preference order (best rank first) — for reporting, not the hot path. */
  sortedIds() {
    return [...this.#items].sort((a, b) => a.rank - b.rank).map((item) => item.id);
  }

  #siftUp(index) {
    let i = index;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.#items[parent].rank >= this.#items[i].rank) break;
      this.#swap(parent, i);
      i = parent;
    }
  }

  #siftDown(index) {
    let i = index;
    const n = this.#items.length;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let largest = i;
      if (left < n && this.#items[left].rank > this.#items[largest].rank) largest = left;
      if (right < n && this.#items[right].rank > this.#items[largest].rank) largest = right;
      if (largest === i) break;
      this.#swap(i, largest);
      i = largest;
    }
  }

  #swap(a, b) {
    const tmp = this.#items[a];
    this.#items[a] = this.#items[b];
    this.#items[b] = tmp;
  }
}
