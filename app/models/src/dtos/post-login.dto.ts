import { Expose } from 'class-transformer';

export class PostLoginDto {
  @Expose()
  username: string;
  @Expose()
  password: string;
}
