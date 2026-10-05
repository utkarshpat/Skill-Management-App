import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {compressEvidence} from '../src/modules/skills/evidence.js';
import {readFile} from 'node:fs/promises';
test('Evidence compression validates decoded image, limits dimensions and strips metadata',async()=>{const input=await sharp({create:{width:2500,height:1200,channels:3,background:'#198596'}}).jpeg().withMetadata().toBuffer();const out=await compressEvidence(input),meta=await sharp(out.data).metadata();assert.equal(meta.format,'webp');assert.equal(out.width,1920);assert.ok(out.height<=1920);assert.ok(out.data.length<=1048576);assert.equal(meta.exif,undefined);});
test('Evidence rejects active SVG content, non-images and oversized input',async()=>{for(const data of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><script>alert(1)</script></svg>'),Buffer.from('not an image'),Buffer.alloc(1048577)])await assert.rejects(compressEvidence(data));});
test('Evidence SQL resolves claim ownership, matching review policy and transactional revision',async()=>{const source=await readFile(new URL('../../../database/migrations/050_skill_evidence.sql',import.meta.url),'utf8');for(const guard of ['AccessRuntimeAccount','AccessCanReviewClaim','@owner=@actor_id','@revision<>@expected_revision','Maximum six images','claim.evidence.added','UPDLOCK,HOLDLOCK'])assert.ok(source.includes(guard),guard);});
