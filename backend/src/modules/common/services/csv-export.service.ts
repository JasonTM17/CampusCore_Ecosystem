import { Injectable } from '@nestjs/common';
import { stringify } from 'csv-stringify';

@Injectable()
export class CsvExportService {
  async generateCsv<T extends Record<string, unknown>>(
    data: T[],
    columns?: string[]
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const stringifier = stringify(
        {
          header: true,
          columns: columns,
        },
        (err, output) => {
          if (err) reject(err);
          else resolve(output);
        }
      );

      data.forEach((row) => stringifier.write(row));
      stringifier.end();
    });
  }
}
