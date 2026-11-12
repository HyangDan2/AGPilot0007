// Synthetic EXIF DateTimeOriginal; the JPEG pixels come from a local test image.
export function withExifDate(jpeg: Buffer, date='2016:03:08 23:59:59', orientation=1): Buffer {
  const tiff=Buffer.alloc(76);tiff.write('II');tiff.writeUInt16LE(42,2);tiff.writeUInt32LE(8,4);
  tiff.writeUInt16LE(2,8);
  tiff.writeUInt16LE(0x0112,10);tiff.writeUInt16LE(3,12);tiff.writeUInt32LE(1,14);tiff.writeUInt16LE(orientation,18);
  tiff.writeUInt16LE(0x8769,22);tiff.writeUInt16LE(4,24);tiff.writeUInt32LE(1,26);tiff.writeUInt32LE(38,30);
  tiff.writeUInt16LE(1,38);tiff.writeUInt16LE(0x9003,40);tiff.writeUInt16LE(2,42);tiff.writeUInt32LE(20,44);tiff.writeUInt32LE(56,48);tiff.write(date+'\0',56,'ascii');
  const payload=Buffer.concat([Buffer.from('Exif\0\0'),tiff]);const header=Buffer.alloc(4);header[0]=0xff;header[1]=0xe1;header.writeUInt16BE(payload.length+2,2);
  return Buffer.concat([jpeg.subarray(0,2),header,payload,jpeg.subarray(2)]);
}
