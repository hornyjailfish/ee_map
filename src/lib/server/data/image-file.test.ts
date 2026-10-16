import { describe, it, expect } from 'vitest';
import { FileRef } from 'surrealdb';
import { parseImageDataUrl, parseImageFileRef } from './image-file';

describe('parseImageFileRef', () => {
	it('accepts an images bucket FileRef', () => {
		const ref = new FileRef('images', 'bca23145-1a1e-4838-99b7-e4c7d9c54cc2.jpg');
		expect(parseImageFileRef(ref)).toBe(ref);
	});

	it('accepts nested keys with slashes', () => {
		const ref = new FileRef('images', 'sub/dir/photo.webp');
		expect(parseImageFileRef(ref)).toBe(ref);
	});

	it('rejects other buckets and non-FileRef values', () => {
		expect(parseImageFileRef(new FileRef('other', 'photo.png'))).toBeNull();
		expect(parseImageFileRef('images:anything.jpg')).toBeNull();
		expect(parseImageFileRef(42)).toBeNull();
		expect(parseImageFileRef(null)).toBeNull();
	});
});

describe('parseImageDataUrl', () => {
	it('decodes a base64 image data URL', () => {
		const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
		const b64 = Buffer.from(bytes).toString('base64');
		const result = parseImageDataUrl(`data:image/png;base64,${b64}`);
		expect(result?.mime).toBe('image/png');
		expect([...result!.bytes]).toEqual([0x89, 0x50, 0x4e, 0x47]);
	});

	it('rejects non-image and malformed payloads', () => {
		expect(parseImageDataUrl('data:text/plain;base64,aGk=')).toBeNull();
		expect(parseImageDataUrl('data:image/png;base64,!!!not-base64!!!')).toBeNull();
		expect(parseImageDataUrl('data:image/png;base64,')).toBeNull();
		expect(parseImageDataUrl('')).toBeNull();
		expect(parseImageDataUrl(undefined)).toBeNull();
	});
});