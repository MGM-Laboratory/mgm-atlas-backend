import { Module } from '@nestjs/common';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { DueDateScanService } from './due-date-scan.service';

@Module({
  imports: [NotificationsModule],
  providers: [DueDateScanService],
})
export class SchedulingModule {}
