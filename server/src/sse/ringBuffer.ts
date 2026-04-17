export interface RingEntry<T> { id: number; value: T }

export class RingBuffer<T> {
  private readonly entries: RingEntry<T>[] = [];
  private nextId = 1;
  constructor(private readonly capacity: number) {}

  push(value: T): RingEntry<T> {
    const entry = { id: this.nextId++, value };
    this.entries.push(entry);
    if (this.entries.length > this.capacity) this.entries.shift();
    return entry;
  }

  since(lastId: number): RingEntry<T>[] | null {
    if (this.entries.length === 0) return [];
    const oldest = this.entries[0]!.id;
    if (lastId < oldest) return null;
    return this.entries.filter((e) => e.id > lastId);
  }
}
