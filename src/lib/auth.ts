const domain = process.env.NEXT_PUBLIC_COGNITO_DOMAIN || "";
const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || "";
const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
export const cloudConfigured = !!(domain && clientId);
function authUrl() {
  if (!cloudConfigured) throw new Error("Add the Cognito stack outputs to .env.local, then restart Next.js.");
  const url = new URL(domain.startsWith("https://") ? domain : `https://${domain}`);
  if(url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) throw new Error("Use the HTTPS Cognito domain from the stack outputs.");
  return url;
}
function base64Url(bytes:Uint8Array) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
export async function signIn() {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const state = base64Url(crypto.getRandomValues(new Uint8Array(24)));
  const challenge = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier))));
  sessionStorage.setItem("lab-oauth",JSON.stringify({state,verifier,createdAt:Date.now()}));
  const url = new URL("/oauth2/authorize",authUrl());
  url.search = new URLSearchParams({response_type:"code",client_id:clientId,redirect_uri:`${appUrl.replace(/\/$/,"")}/auth/callback`,scope:"openid email",state,code_challenge:challenge,code_challenge_method:"S256"}).toString();
  window.location.assign(url);
}
export async function finishSignIn(search:string) {
  const params = new URLSearchParams(search);
  const pending = JSON.parse(sessionStorage.getItem("lab-oauth") || "null");
  if(params.has("error")) throw new Error("Sign-in was cancelled or denied. Return to the lab and try again.");
  if(!pending || pending.state !== params.get("state") || Date.now()-pending.createdAt > 600000 || !params.get("code")) throw new Error("This sign-in request is expired or invalid. Start again from the lab.");
  const response = await fetch(new URL("/oauth2/token",authUrl()),{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"authorization_code",client_id:clientId,code:params.get("code")!,redirect_uri:`${appUrl.replace(/\/$/,"")}/auth/callback`,code_verifier:pending.verifier}),signal:AbortSignal.timeout(10000)});
  if(!response.ok) throw new Error("The identity provider could not finish sign-in. Start again from the lab.");
  const token = await response.json();
  if(typeof token.access_token !== "string" || !Number.isFinite(token.expires_in)) throw new Error("The identity provider returned an invalid response.");
  sessionStorage.setItem("lab-token",JSON.stringify({token:token.access_token,expiresAt:Date.now()+token.expires_in*1000}));
  sessionStorage.removeItem("lab-oauth");
}
export function getToken():string|null {
  if(typeof window === "undefined") return null;
  try { const value=JSON.parse(sessionStorage.getItem("lab-token")||"null");return value?.expiresAt>Date.now()+30000 && typeof value.token==="string" ? value.token : null; } catch { return null; }
}
