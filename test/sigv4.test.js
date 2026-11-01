import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signV4, parseList } from '../server/s3.js';

const creds = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 's3' };
const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

// Official examples from the AWS Signature Version 4 documentation (examplebucket).
test('SigV4 matches the AWS "GET Object" test vector', () => {
  const s = signV4({ ...creds, method: 'GET', host: 'examplebucket.s3.amazonaws.com', pathname: '/test.txt', headers: { Range: 'bytes=0-9' }, payloadHash: EMPTY, amzDate: '20130524T000000Z' });
  assert.equal(s.signature, 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
});

test('SigV4 matches the AWS "GET Bucket (List Objects)" test vector (query string)', () => {
  const s = signV4({ ...creds, method: 'GET', host: 'examplebucket.s3.amazonaws.com', pathname: '/', query: { 'max-keys': '2', prefix: 'J' }, payloadHash: EMPTY, amzDate: '20130524T000000Z' });
  assert.equal(s.signature, '34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
});

test('SigV4 matches the AWS "PUT Object" test vector (special characters in the key)', () => {
  const s = signV4({
    ...creds, method: 'PUT', host: 'examplebucket.s3.amazonaws.com', pathname: '/test$file.text',
    headers: { Date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' },
    payloadHash: '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072', amzDate: '20130524T000000Z'
  });
  assert.equal(s.signature, '98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
});

test('ListObjectsV2 XML is parsed, including entities and prefixes', () => {
  const xml = `<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>abc</NextContinuationToken>
    <Contents><Key>a&amp;b.txt</Key><Size>12</Size><LastModified>2026-01-01T00:00:00.000Z</LastModified><ETag>"x"</ETag></Contents>
    <CommonPrefixes><Prefix>photos/</Prefix></CommonPrefixes></ListBucketResult>`;
  const r = parseList(xml);
  assert.deepEqual(r.objects.map((o) => [o.key, o.size]), [['a&b.txt', 12]]);
  assert.deepEqual(r.prefixes, ['photos/']);
  assert.equal(r.truncated, true);
  assert.equal(r.nextToken, 'abc');
});
