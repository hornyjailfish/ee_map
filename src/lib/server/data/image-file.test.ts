import { describe, it, expect } from 'vitest';
import { parseImageDataUrl, parseImageFileRef } from './image-file';

describe('parseImageFileRef', () => {
	it('accepts a plain images bucket reference', () => {
		expect(parseImageFileRef('images:bca23145-1a1e-4838-99b7-e4c7d9c54cc2.jpg')).toEqual({
			bucket: 'images',
			key: 'bca23145-1a1e-4838-99b7-e4c7d9c54cc2.jpg'
		});
	});

	it('accepts nested keys with slashes', () => {
		expect(parseImageFileRef('images:sub/dir/photo.webp')).toEqual({
			bucket: 'images',
			key: 'sub/dir/photo.webp'
		});
	});

	it('rejects traversal, other buckets, and malformed values', () => {
		expect(parseImageFileRef('images:../secret.png')).toBeNull();
		expect(parseImageFileRef('other:bucket.png')).toBeNull();
		expect(parseImageFileRef('images:')).toBeNull();
		expect(parseImageFileRef('images:bad key.png')).toBeNull();
		expect(parseImageFileRef('no-colon')).toBeNull();
		expect(parseImageFileRef(42)).toBeNull();
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