import { Module } from '@nestjs/common';
import { CsvExportService } from './services/csv-export.service';

@Module({
  providers: [CsvExportService],
  exports: [CsvExportService],
})
export class CommonModule {}
