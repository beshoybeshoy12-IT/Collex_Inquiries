import {
  contentDisposition,
  decodeUploadName,
  safeFileName,
} from './file-name.util';

describe('file names', () => {
  it('repairs an Arabic name that multipart decoded as Latin-1', () => {
    const garbled = Buffer.from('عقد الإيجار.pdf', 'utf8').toString('latin1');
    expect(decodeUploadName(garbled)).toBe('عقد الإيجار.pdf');
  });

  it('leaves real Latin-1, ASCII and proper Unicode names alone', () => {
    expect(decodeUploadName('café.pdf')).toBe('café.pdf');
    expect(decodeUploadName('scan 01.pdf')).toBe('scan 01.pdf');
    expect(decodeUploadName('عقد.pdf')).toBe('عقد.pdf');
  });

  it('strips paths, quotes and control characters', () => {
    expect(safeFileName('../a"b\\c\r\n.pdf')).toBe('..abc.pdf');
    expect(safeFileName('')).toBe('file');
  });

  it('sends an ASCII fallback plus the real name for the header', () => {
    expect(contentDisposition('عقد.pdf')).toBe(
      `attachment; filename="___.pdf"; filename*=UTF-8''${encodeURIComponent('عقد.pdf')}`,
    );
  });
});
