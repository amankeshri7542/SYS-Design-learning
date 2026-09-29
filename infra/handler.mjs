import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { readFileSync } from "node:fs";
const bounds = JSON.parse(readFileSync(new URL("./concepts.json", import.meta.url),"utf8"));
const db = DynamoDBDocumentClient.from(new DynamoDBClient({maxAttempts:2}));
const reply = (statusCode, body) => ({statusCode,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},body:JSON.stringify(body)});
export function validateProgress(input) {
  if(!input || typeof input !== "object" || !Object.hasOwn(bounds,input.conceptId)) return false;
  const bound=bounds[input.conceptId];
  return Number.isInteger(input.traffic) && input.traffic>=50 && input.traffic<=2000 &&
    Number.isInteger(input.replicas) && input.replicas>=1 && input.replicas<=8 &&
    Number.isFinite(input.parameter) && input.parameter>=bound.min && input.parameter<=bound.max;
}
export async function handler(event) {
  // Only the API Gateway JWT authorizer supplies this subject; never accept a user ID in the body.
  const sub = event.requestContext?.authorizer?.jwt?.claims?.sub;
  if(typeof sub!=="string" || !/^[a-fA-F0-9-]{36}$/.test(sub)) return reply(401,{error:"Unauthenticated"});
  const pk=`USER#${sub}`;
  try {
    if(event.requestContext.http.method === "GET") {
      const result=await db.send(new QueryCommand({TableName:process.env.PROGRESS_TABLE,KeyConditionExpression:"pk = :pk AND begins_with(sk, :prefix)",ExpressionAttributeValues:{":pk":pk,":prefix":"CONCEPT#"},Limit:56,ConsistentRead:true}));
      return reply(200,{items:(result.Items??[]).map(({conceptId,traffic,replicas,parameter,updatedAt})=>({conceptId,traffic,replicas,parameter,updatedAt}))});
    }
    if(event.requestContext.http.method!=="POST") return reply(405,{error:"Method not allowed"});
    const body=event.isBase64Encoded?Buffer.from(event.body??"","base64").toString("utf8"):event.body??"";
    if(Buffer.byteLength(body)>2048) return reply(413,{error:"Request is too large"});
    let input;try{input=JSON.parse(body);}catch{return reply(400,{error:"Invalid JSON"});}
    if(!validateProgress(input)) return reply(400,{error:"Invalid progress record"});
    const {conceptId,traffic,replicas,parameter}=input;
    const updatedAt=new Date().toISOString();
    // A repeated completion replaces the same item; retries cannot create duplicate progress rows.
    await db.send(new PutCommand({TableName:process.env.PROGRESS_TABLE,Item:{pk,sk:`CONCEPT#${conceptId}`,conceptId,traffic,replicas,parameter,completed:true,updatedAt}}));
    return reply(200,{conceptId,updatedAt});
  } catch(error) {
    console.error(JSON.stringify({event:"progress_failed",requestId:event.requestContext?.requestId,error:error?.name??"UnknownError"}));
    return reply(503,{error:"Progress storage is temporarily unavailable"});
  }
}
