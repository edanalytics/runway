import { Module } from '@nestjs/common';
import { EventEmitterService } from './event-emitter.service';

@Module({
  providers: [EventEmitterService],
  exports: [EventEmitterService],
})
export class EventEmitterModule {}
