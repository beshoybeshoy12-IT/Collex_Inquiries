import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { extname } from 'node:path';
import { envInt } from '../config/env';
import { sniffSignature } from '../utils/file-signature.util';

/**
 * Validates an uploaded spreadsheet.
 *
 * `file.mimetype` IS A CLIENT-SUPPLIED HEADER AND IS NEVER TRUSTED. A request
 * can claim any content type it likes; the only thing that says what a file
 * actually is, is the file. So this checks three things, and all of them have
 * to agree:
 *
 *   1. the extension is on the allow-list;
 *   2. the first bytes match a format we accept;
 *   3. the size is within the cap.
 *
 * `.xls` (the pre-2007 OLE compound format) is accepted because banks still
 * send it. `.csv` is accepted with no signature check, because a CSV has no
 * magic bytes — it is validated by the parser instead, which is the honest
 * place for it.
 */

const ALLOWED_EXTENSIONS = new Set(['.xlsx', '.xlsm', '.xls', '.csv']);

@Injectable()
export class ExcelFilePipe implements PipeTransform<Express.Multer.File> {
  private readonly maxBytes = envInt('IMPORT_MAX_MB', 20) * 1024 * 1024;

  transform(file: Express.Multer.File): Express.Multer.File {
    if (!file) {
      throw new BadRequestException('الملف مطلوب - A file is required');
    }

    if (file.size > this.maxBytes) {
      throw new BadRequestException(
        `حجم الملف يتجاوز ${Math.round(this.maxBytes / 1024 / 1024)} ميجابايت - ` +
          `The file exceeds ${Math.round(this.maxBytes / 1024 / 1024)} MB`,
      );
    }

    const extension = extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      throw new BadRequestException(
        `نوع الملف غير مدعوم (${extension || 'unknown'})، المسموح: ${[...ALLOWED_EXTENSIONS].join(', ')} - ` +
          `Unsupported file type; allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}`,
      );
    }

    // A CSV is plain text with no signature to check. The parser rejects it if
    // it is not really tabular, which is the only check that means anything.
    if (extension === '.csv') return file;

    const signature = sniffSignature(file.buffer);
    if (signature !== 'zip' && signature !== 'ole') {
      // .xlsx/.xlsm are ZIP containers; .xls is an OLE compound file.
      throw new BadRequestException(
        'محتوى الملف لا يطابق امتداده - ' +
          'The file contents do not match its extension',
      );
    }

    return file;
  }
}
