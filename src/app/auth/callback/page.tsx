"use client";
import { useEffect, useRef, useState } from "react";
import { finishSignIn } from "@/lib/auth";
export default function Callback() {
  const [error,setError] = useState("");
  const started = useRef(false);
  useEffect(()=>{if(started.current)return;started.current=true;finishSignIn(window.location.search).then(()=>window.location.replace("/")).catch(error=>setError(error instanceof Error?error.message:"Sign-in failed."));},[]);
  return <main className="auth-page"><h1>{error?"Sign-in needs another try":"Connecting your learning progress…"}</h1><p role="status">{error||"Verifying your AWS identity."}</p><a href="/">Return to System Lab →</a></main>;
}
