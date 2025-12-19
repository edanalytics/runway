import { Expose } from 'class-transformer';

/** Minimal dto/typing with `id` property for use in places that require it */
export class Id {
  constructor(id: number) {
    this.id = id;
  }
  @Expose()
  id: number;
}
