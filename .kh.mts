import './scripts/operator/env'
import {createPublicClient, http, getAddress} from 'viem'
const T=getAddress('0x3EAd4E80e9e5bC0e01682D7Ee74C4881b040D3EA')
const TR='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
async function main(){
  const c=createPublicClient({transport:http(process.env.ARC_MAINNET_RPC_URL ?? 'https://rpc.mainnet.arc.io',{retryCount:8,retryDelay:2500})})
  const head=await c.getBlockNumber()
  const bal=new Map<string,bigint>(); let w=0,f=0,n=0
  for(let from=head-3_300_000n; from<=head; from+=4_900n){
    const to=from+4_899n>head?head:from+4_899n
    try{
      const g=await c.request({method:'eth_getLogs',params:[{fromBlock:`0x${from.toString(16)}`,toBlock:`0x${to.toString(16)}`,address:T,topics:[TR]}]} as never) as Array<{topics:string[];data:string}>
      for(const l of g){n++
        const a='0x'+l.topics[1]!.slice(26), b='0x'+l.topics[2]!.slice(26), v=BigInt(l.data)
        if(BigInt(a)!==0n) bal.set(a,(bal.get(a)??0n)-v)
        if(BigInt(b)!==0n) bal.set(b,(bal.get(b)??0n)+v)}
    }catch{f++}
    w++
    await new Promise(r=>setTimeout(r,300))
  }
  const h=[...bal.values()].filter(v=>v>0n).length
  console.log(`windows ${w} failed ${f} transfers ${n}`)
  console.log(`HOLDERS ${h} -> ${h>=1000?'clears':'below'} the 1,000 threshold`)
}
void main()
