'use strict';
// Synthetic-data tests only. Production always uses its existing PostgreSQL pool.
async function memoryPool() {
  const {PGlite}=require('@electric-sql/pglite');
  const db=new PGlite(); await db.waitReady;
  let tail=Promise.resolve();
  const query=async (sql,params)=>{
    if(!params && sql.trim().split(';').filter(v=>v.trim()).length>1){
      const results=await db.exec(sql);return results.at(-1)||{rows:[],rowCount:0};
    }
    const result=await db.query(sql,params);
    return {...result,rowCount:result.affectedRows ?? result.rows?.length ?? 0};
  };
  return {query,async connect(){
    const previous=tail;let unlock;tail=new Promise(resolve=>{unlock=resolve;});await previous;
    return {query,release:unlock};
  },end:()=>db.close()};
}
module.exports={memoryPool};
