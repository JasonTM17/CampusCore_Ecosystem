import { Module } from '@nestjs/common';
import { CsvExportService } from './services/csv-export.service';
import { EmailService } from './services/email.service';

@Module({
  providers: [CsvExportService, EmailService],
  exports: [CsvExportService, EmailService],
})
export class CommonModule {}
