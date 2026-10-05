const test=require('node:test');
const assert=require('node:assert/strict');
const {score,valid}=require('../personalization-method.js');
test('quiz preserves opposite practice and grammar preferences',()=>{
  assert.deepEqual(score([0,0,0,2,2,2,0,3]),{version:1,output:0,grammar:100,modalities:['visual','speaking']});
});
test('quiz averages balanced answers and deduplicates formats',()=>{
  assert.deepEqual(score([0,1,2,0,1,2,1,1]),{version:1,output:50,grammar:50,modalities:['audio']});
});
test('incomplete or invalid quiz answers cannot produce results',()=>{
  for(const value of [[],[0,0,0,0,0,0,0,null],[0,0,0,0,0,0,0,6],[0,0,0,0,0,0,0,1.5]])assert.throws(()=>score(value));
});
test('stored preference validation rejects corrupted or unsupported profiles',()=>{
  const good=score([1,1,1,1,1,1,1,2]); assert.equal(valid(good),true);
  for(const value of [null,{}, {...good,output:101},{...good,grammar:'50'},{...good,modalities:[]},{...good,modalities:['audio','audio']},{...good,modalities:['unknown']},{...good,version:2}])assert.equal(valid(value),false);
});
