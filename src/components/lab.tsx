"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUpRight, BookOpen, Boxes, Check, ChevronDown, ChevronRight, CircleHelp, Clock3, Cloud, Code2, Database, ExternalLink, FlaskConical, Gauge, GitBranch, GraduationCap, Heart, Layers3, Menu, Network, Pause, Play, Radio, RotateCcw, Search, ShieldCheck, Sparkles, Terminal, Timer, Trophy, X, Zap } from "lucide-react";
import { concepts, defaultConcept, groups, getConcept, type Concept, type GroupId } from "@/lib/catalog";
import { getControl, simulate, type SimulationResult } from "@/lib/simulation";
import { Architecture } from "./architecture";
import { signIn, cloudConfigured, getToken } from "@/lib/auth";
const groupIcons = {caching:Layers3,scaling:Network,data:Database,messaging:Radio,resilience:ShieldCheck,security:ShieldCheck,distributed:GitBranch};
const storageKey = "system-lab-progress-v1";
type Page = "playground" | "library" | "aws" | "progress";
const format = (value: number) => new Intl.NumberFormat("en-US",{maximumFractionDigits:1}).format(value);
export function Lab() {
  const [concept,setConcept] = useState<Concept>(defaultConcept);
  const [page,setPage] = useState<Page>("playground");
  const [openGroup,setOpenGroup] = useState<GroupId>("caching");
  const [traffic,setTraffic] = useState(1200);
  const [replicas,setReplicas] = useState(3);
  const [parameter,setParameter] = useState(60);
  const [running,setRunning] = useState(false);
  const [elapsed,setElapsed] = useState(0);
  const [result,setResult] = useState<SimulationResult>(()=>simulate({conceptId:defaultConcept.id,traffic:1200,replicas:3,parameter:60}));
  const [completed,setCompleted] = useState<string[]>([]);
  const [query,setQuery] = useState("");
  const [filter,setFilter] = useState<GroupId|"all">("all");
  const [inspector,setInspector] = useState<"learn"|"code">("learn");
  const [notice,setNotice] = useState("");
  const [mobileNav,setMobileNav] = useState(false);
  const [help,setHelp] = useState(false);
  const [signedIn,setSignedIn] = useState(false);
  const [loading,setLoading] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const helpDialogRef = useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(help)helpDialogRef.current?.showModal();},[help]);
  useEffect(()=>{
    try { const saved:unknown=JSON.parse(localStorage.getItem(storageKey)||"[]"); if(Array.isArray(saved))setCompleted([...new Set(saved.filter((id):id is string=>typeof id==="string"&&!!getConcept(id)))]); } catch { setNotice("Browser storage is unavailable. Progress will last for this session."); }
    setSignedIn(!!getToken());
    const id=new URLSearchParams(window.location.search).get("concept");
    const next=id?getConcept(id):undefined;
    if(next){setConcept(next);setOpenGroup(next.group);setParameter(getControl(next).initial);setResult(simulate({conceptId:next.id,traffic:1200,replicas:3,parameter:getControl(next).initial}));}
    const key=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key==="k"){event.preventDefault();setPage("library");setTimeout(()=>searchRef.current?.focus(),0);}if(event.key==="Escape"){setHelp(false);setMobileNav(false);}};
    window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key);
  },[]);
  useEffect(()=>{if(!notice)return;const timeout=setTimeout(()=>setNotice(""),6000);return()=>clearTimeout(timeout);},[notice]);
  useEffect(()=>{if(!running)return;const timer=setInterval(()=>setElapsed(current=>{if(current>=23){setRunning(false);return 24;}return current+1;}),650);return()=>clearInterval(timer);},[running]);
  const control=getControl(concept);
  const point=result.points[Math.max(0,Math.min(elapsed-1,result.points.length-1))];
  const shownPoint=elapsed?point:result.points[23];
  const step=elapsed?Math.min(3,Math.floor((elapsed-1)/6)):-1;
  const finished=elapsed===24;
  const group=groups.find(g=>g.id===concept.group)!;
  const selectConcept=(next:Concept)=>{
    requestId.current++;setLoading(false);setRunning(false);setElapsed(0);setConcept(next);setOpenGroup(next.group);setParameter(getControl(next).initial);setPage("playground");setInspector("learn");setMobileNav(false);
    setResult(simulate({conceptId:next.id,traffic,replicas,parameter:getControl(next).initial}));
    history.replaceState(null,"",`?concept=${next.id}`);
  };
  const changeControls=(next:{traffic?:number;replicas?:number;parameter?:number})=>{
    requestId.current++;setLoading(false);setRunning(false);setElapsed(0);
    const values={conceptId:concept.id,traffic:next.traffic??traffic,replicas:next.replicas??replicas,parameter:next.parameter??parameter};
    setTraffic(values.traffic);setReplicas(values.replicas);setParameter(values.parameter);setResult(simulate(values));
  };
  const start=async()=>{
    if(running){setRunning(false);return;}
    if(elapsed>0&&elapsed<24){setRunning(true);return;}
    const currentRequest=++requestId.current;setLoading(true);
    try {
      const response=await fetch("/api/simulate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({conceptId:concept.id,traffic,replicas,parameter})});
      if(!response.ok)throw new Error("The simulation could not start. Please try again.");
      const next:SimulationResult=await response.json();
      if(currentRequest!==requestId.current)return;
      setResult(next);setElapsed(1);setRunning(true);
    }catch(error){if(currentRequest===requestId.current)setNotice(error instanceof Error?error.message:"Simulation unavailable.");}
    finally{if(currentRequest===requestId.current)setLoading(false);}
  };
  const reset=()=>{requestId.current++;setLoading(false);setRunning(false);setElapsed(0);};
  const complete=async()=>{
    const next=[...new Set([...completed,concept.id])];setCompleted(next);
    try{localStorage.setItem(storageKey,JSON.stringify(next));setNotice("Concept completed. Progress saved in this browser.");}catch{setNotice("Concept completed for this session. Browser storage is unavailable.");}
    if(signedIn){try{const response=await fetch("/api/runs",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${getToken()}`},body:JSON.stringify({conceptId:concept.id,traffic,replicas,parameter})});if(!response.ok)throw new Error();setNotice("Progress synced to your AWS account.");}catch{setNotice("Saved locally. Cloud sync failed; reconnect in AWS architecture and retry.");}}
  };
  const connect=async()=>{try{await signIn();}catch(error){setNotice(error instanceof Error?error.message:"Could not start sign-in.");}};
  const sync=async()=>{setLoading(true);try{const response=await fetch("/api/runs",{headers:{Authorization:`Bearer ${getToken()}`}});if(!response.ok)throw new Error();const data=await response.json();const ids=(data.items??[]).map((i:{conceptId:string})=>i.conceptId).filter((id:string)=>!!getConcept(id));const merged=[...new Set([...completed,...ids])] as string[];setCompleted(merged);localStorage.setItem(storageKey,JSON.stringify(merged));setNotice("Cloud progress loaded and merged with this browser.");}catch{setNotice("Could not load cloud progress. Check your connection and sign in again.");}finally{setLoading(false);}};
  const filtered=concepts.filter(c=>(filter==="all"||c.group===filter)&&`${c.title} ${c.description} ${c.service}`.toLowerCase().includes(query.toLowerCase()));
  const navigate=(next:Page)=>{setPage(next);setMobileNav(false);};
  return <div className="app-shell">
    {mobileNav&&<button className="nav-scrim" aria-label="Close navigation" onClick={()=>setMobileNav(false)}/>}
    <aside className={`sidebar ${mobileNav?"mobile-open":""}`}>
      <a href="/" className="brand"><span className="brand-icon"><Layers3 size={23}/></span><span>system<span className="brand-light">lab</span><small>THINK IT. SEE IT. BUILD IT.</small></span></a>
      <div className="workspace-label"><span className="workspace-avatar">A</span><span>Aman’s workspace<small>Personal learning space</small></span><ChevronDown size={14}/></div>
      <div className="sidebar-scroll">
        <div className="nav-section-title">WORKSPACE</div>
        <nav className="main-nav" aria-label="Workspace">
          <button className={page==="playground"?"selected":""} onClick={()=>navigate("playground")}><FlaskConical size={18}/>Playground<span className="tiny-badge">LAB</span></button>
          <button className={page==="library"?"selected":""} onClick={()=>navigate("library")}><BookOpen size={18}/>Concept library<span className="nav-count">56</span></button>
          <button className={page==="aws"?"selected":""} onClick={()=>navigate("aws")}><Cloud size={18}/>AWS architecture<ArrowUpRight size={14} className="nav-end"/></button>
        </nav>
        <div className="nav-section-title learning-title">LEARNING PATHS<span>7</span></div>
        <nav className="learning-nav" aria-label="Learning paths">
          {groups.map(g=>{const Icon=groupIcons[g.id];const entries=concepts.filter(c=>c.group===g.id);return <div key={g.id} className={`learning-group ${openGroup===g.id?"expanded":""}`}><button className="group-toggle" aria-expanded={openGroup===g.id} onClick={()=>setOpenGroup(openGroup===g.id?"" as GroupId:g.id)}><Icon size={16}/><span>{g.name}</span><small>8</small><ChevronRight size={13}/></button>{openGroup===g.id&&<div className="concept-links">{entries.map(c=><button key={c.id} className={concept.id===c.id&&page==="playground"?"active":""} onClick={()=>selectConcept(c)}><span className="concept-dot">{completed.includes(c.id)?<Check size={10}/>:null}</span>{c.title}{concept.id===c.id&&page==="playground"&&<span className="active-dot"/>}</button>)}</div>}</div>})}
        </nav>
      </div>
      <div className="sidebar-bottom"><button className="progress-card" onClick={()=>navigate("progress")}><span className="progress-icon"><GraduationCap size={20}/></span><span>Your learning journey<strong>{completed.length} <small>/ 56 concepts explored</small></strong></span><ArrowUpRight size={14}/><span className="progress-track"><i style={{width:`${completed.length/56*100}%`}}/></span></button><a className="creator" href="https://amankeshri.com" target="_blank" rel="noreferrer">Made with <Heart size={11} fill="currentColor"/><span className="sr-only">heart</span> by <strong>Aman</strong><ArrowUpRight size={11}/></a></div>
    </aside>
    <div className="app-content">
      <header className="topbar"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={()=>setMobileNav(true)}><Menu size={21}/></button><div className="breadcrumbs"><span>Workspace</span><ChevronRight size={13}/><strong>{page==="playground"?"Playground":page==="library"?"Concept library":page==="aws"?"AWS architecture":"My progress"}</strong></div><div className="topbar-actions"><button className="search-shortcut" aria-label="Find a concept" onClick={()=>{setPage("library");setTimeout(()=>searchRef.current?.focus(),0);}}><Search size={15}/><span>Find a concept...</span><kbd>⌘ K</kbd></button><span className="simulation-pill"><span/>Simulation mode</span><button className="icon-button" aria-label="How to use System Lab" onClick={()=>setHelp(true)}><CircleHelp size={19}/></button><span className="avatar" aria-label="Aman's workspace">A</span></div></header>
      <main>
        {page==="playground"&&<>
          <div className="page-heading"><div><div className="eyebrow"><span className="blue-dash"/>{group.name.toUpperCase()}<span className="eyebrow-separator">/</span>CONCEPT {String(concepts.findIndex(c=>c.id===concept.id)+1).padStart(2,"0")}</div><h1 ref={headingRef} tabIndex={-1}>{concept.title}<span className={`difficulty ${concept.difficulty.toLowerCase()}`}>{concept.difficulty}</span></h1><p>{concept.description}</p><div className="heading-meta"><span><Clock3 size={13}/>{concept.minutes} min exploration</span><i/><span><Cloud size={14}/>{concept.service}</span></div></div><button className={`button mark-complete ${completed.includes(concept.id)?"completed":""}`} onClick={complete} disabled={!finished&&!completed.includes(concept.id)} title={!finished&&!completed.includes(concept.id)?"Finish a simulation to complete this concept":"Save this concept to your progress"}><Check size={15}/>{completed.includes(concept.id)?"Completed":"Mark complete"}</button></div>
          <div className="lab-grid">
            <section className="experiment-column" aria-label="Interactive experiment">
              <div className="canvas-card"><div className="panel-heading"><div><span className="panel-icon"><GitBranch size={16}/></span><h2>Architecture playground</h2><span className="live-label">INTERACTIVE</span></div><div className="canvas-legend"><span><i className="legend-green"/>{concept.group==="caching"?"Fast path":"Primary path"}</span><span><i className="legend-gray"/>{concept.group==="caching"?"Origin path":"Secondary path"}</span></div></div><Architecture concept={concept} running={running} point={shownPoint} step={step} replicas={replicas} metric={result.metric} unit={result.unit}/><div className="simulation-toolbar"><div><button className="button primary" onClick={start} disabled={loading}>{running?<Pause size={14} fill="currentColor"/>:<Play size={14} fill="currentColor"/>}{loading?"Starting…":running?"Pause simulation":elapsed>0&&elapsed<24?"Resume simulation":"Run simulation"}</button><button className="icon-button reset" onClick={reset} aria-label="Reset simulation"><RotateCcw size={16}/></button><span className="simulation-time"><span className={running?"blink":""}/>{String(elapsed).padStart(2,"0")}<small> / 24 steps</small></span></div><span className="simulation-note">{finished?<><Check size={13}/>Experiment complete</>:<>Change a variable. See what happens.</>}</span></div></div>
              <div className="metrics-grid"><Metric icon={<Timer size={17}/>} label="Modeled latency" value={format(shownPoint.latency)} unit="ms" note={elapsed?"Current simulation step":"Estimated steady state"} color="blue" spark={sparkline(result,"latency")}/><Metric icon={<Gauge size={17}/>} label="Served throughput" value={format(shownPoint.throughput)} unit="req/s" note={`of ${format(traffic)} offered req/s`} color="teal" spark={sparkline(result,"throughput")}/><Metric icon={<Layers3 size={17}/>} label={result.metric} value={format(shownPoint.value)} unit={result.unit} note="From the current configuration" color="purple" spark={sparkline(result,"value")}/></div>
              <div className="detail-grid"><section className="chart-card"><div className="small-panel-heading"><h2>Latency over time</h2><span><i/> Modeled latency</span></div><LatencyChart result={result} elapsed={elapsed}/><div className="chart-caption">{elapsed?`${elapsed} of 24 simulation steps` : "Run the simulation to trace each request"}<span>24 steps</span></div></section><section className="event-card"><div className="small-panel-heading"><h2>Request journey</h2><span className="log-badge">{finished?"COMPLETE":running?"LIVE":"TRACE"}</span></div><ol className="event-list">{result.events.map((event,i)=><li key={event} className={step>=i?"event-done":""}><span>{step>i||finished?<Check size={11}/>:String(i+1).padStart(2,"0")}</span><p>{event}</p>{step===i&&running&&<i/>}</li>)}</ol></section></div>
              {finished&&<div className="outcome-note"><Check size={16}/><div><strong>What to take away</strong><p>{result.summary}</p></div></div>}
              <div className="model-note"><CircleHelp size={13}/><span>Illustrative metrics, not live AWS telemetry. <button onClick={()=>setHelp(true)}>Understand the model</button></span></div>
            </section>
            <aside className="inspector"><div className="inspector-tabs"><button className={inspector==="learn"?"active":""} onClick={()=>setInspector("learn")}><BookOpen size={15}/>Learn & experiment</button><button className={inspector==="code"?"active":""} onClick={()=>setInspector("code")} aria-label="View implementation"><Code2 size={17}/></button></div>
              {inspector==="learn"?<>
                <div className="inspector-section"><span className="section-kicker"><Sparkles size={13}/> THE IDEA</span><h3>{concept.id==="cache-aside"?"A shortcut for your data.":concept.title+", in practice."}</h3><p>{concept.description}</p><div className="insight-callout"><span>Think of it this way</span><p>{analogy(concept)}</p></div></div>
                <div className="inspector-section controls-section"><div className="section-title"><h3>Tune your experiment</h3><span><FlaskConical size={14}/></span></div><Range label="Incoming traffic" value={traffic} min={50} max={2000} step={50} unit="req/s" onChange={value=>changeControls({traffic:value})}/><Range label={concept.compute==="Lambda"?"Worker capacity units":"Replicas / capacity units"} value={replicas} min={1} max={8} step={1} unit="" onChange={value=>changeControls({replicas:value})}/><Range label={control.label} value={parameter} min={control.min} max={control.max} step={control.step} unit={control.unit} onChange={value=>changeControls({parameter:value})}/><div className="experiment-hint"><Zap size={15}/><p>{concept.experiment}</p></div></div>
                <div className="inspector-section tradeoff"><h3><GitBranch size={15}/>The trade-off</h3><p>{concept.tradeoff}</p></div>
                <button className="aws-link" onClick={()=>setPage("aws")}><span className="aws-word">aws<span>⌣</span></span><span>Connect it to the cloud<small>Explore the AWS implementation</small></span><ArrowUpRight size={17}/></button>
              </>:<div className="inspector-section code-inspector"><span className="section-kicker"><Terminal size={13}/> IMPLEMENTATION</span><h3>{concept.compute==="Managed"?"Use the managed data plane":`Use ${concept.compute} compute`}</h3><p>{computeReason(concept)}</p><pre><code>{concept.id==="cache-aside"?`async function getProduct(id) {
  const key = "product:" + id;
  const cached = await cache.get(key);
  if (cached) return JSON.parse(cached);

  const product = await db.find(id);
  if (product) {
    await cache.set(key,
      JSON.stringify(product),
      { EX: 60 });
  }
  return product;
}`:`// ${concept.title}
// Service: ${concept.service}

${concept.steps.map((s,i)=>`// ${i+1}. ${s}`).join("\n")}`}</code></pre><p className="code-caption">{concept.id==="cache-aside"?"Pattern pseudocode. Add input validation, bounded cache timeouts, and database fallback to your adapter.":"Implementation outline. The learning engine models these steps; it does not provision this service."}</p><button className="button" onClick={()=>setPage("aws")}>View AWS mapping<ArrowRight size={14}/></button></div>}
            </aside>
          </div>
          <div className="next-concept"><div><span className="next-icon"><GraduationCap size={22}/></span><span><strong>Understanding comes from experimenting.</strong><small>Change one variable at a time. Notice what moves, and ask why.</small></span></div><button onClick={()=>selectConcept(concepts[(concepts.findIndex(c=>c.id===concept.id)+1)%concepts.length])}>Next: {concepts[(concepts.findIndex(c=>c.id===concept.id)+1)%concepts.length].title}<ArrowRight size={16}/></button></div>
        </>}
        {page==="library"&&<><PageHeading kicker="BUILD YOUR MENTAL MODELS" title="One lab. 56 ways to think." description="From your first cache hit to coordinating across continents. Pick a concept and make it click."/><div className="library-toolbar"><div className="search-field"><Search size={18}/><input ref={searchRef} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search concepts, patterns, or AWS services" aria-label="Search concepts"/>{query&&<button className="icon-button" aria-label="Clear search" onClick={()=>setQuery("")}><X size={15}/></button>}</div><span>{filtered.length} {filtered.length===1?"concept":"concepts"}</span></div><div className="filter-chips"><button className={filter==="all"?"active":""} onClick={()=>setFilter("all")}>All concepts</button>{groups.map(g=><button key={g.id} className={filter===g.id?"active":""} onClick={()=>setFilter(g.id)}>{g.name}</button>)}</div><div className="library-grid">{filtered.map(c=>{const Icon=groupIcons[c.group];return <button key={c.id} className="concept-card" onClick={()=>selectConcept(c)}><div><span className={`category-icon ${c.group}`}><Icon size={22}/></span>{completed.includes(c.id)?<span className="complete-badge"><Check size={12}/>Explored</span>:<span className="card-time">{c.minutes} min</span>}</div><span className="card-category">{groups.find(g=>g.id===c.group)?.name}</span><h2>{c.title}</h2><p>{c.description}</p><footer><span>{c.service}</span><ArrowUpRight size={18}/></footer></button>})}</div>{!filtered.length&&<div className="empty-state"><Search size={32}/><h2>No concepts found</h2><p>Try a broader term, or clear the category filter.</p><button className="button" onClick={()=>{setQuery("");setFilter("all");}}>Clear filters</button></div>}</>}
        {page==="aws"&&<><PageHeading kicker="FROM MENTAL MODEL TO INFRASTRUCTURE" title="Your cloud, with a blueprint." description="One small backend for progress. Purpose-built AWS services for each lesson. Provision only what you want to explore."/><div className="cloud-banner"><span className="cloud-banner-icon"><Cloud size={29}/></span><div><h2>{signedIn?"Your AWS identity is connected":"The lab runs without an AWS account."}</h2><p>{signedIn?"Completed concepts can sync through Cognito, API Gateway, Lambda, and DynamoDB.":"All 56 lessons run locally. Connect the optional backend to save progress across devices."}</p></div><button className="button primary" onClick={signedIn?sync:connect} disabled={loading||!cloudConfigured}>{signedIn?"Load cloud progress":cloudConfigured?"Connect AWS identity":"AWS not configured"}<ArrowUpRight size={15}/></button></div><section className="cloud-architecture"><div className="small-panel-heading"><h2>The application architecture</h2><span>OPTIONAL CLOUD BACKEND</span></div><div className="cloud-flow">{[["Next.js","Learning interface"],["Cognito","User identity"],["API Gateway","JWT authorization"],["Lambda","Validate & save"],["DynamoDB","Learning progress"]].map(([title,description],i)=><div key={title}><span className="cloud-flow-node">{i===0?<Boxes size={23}/>:i===1?<ShieldCheck size={23}/>:i===2?<Network size={23}/>:i===3?<Zap size={23}/>:<Database size={23}/>}<strong>{title}</strong><small>{description}</small></span>{i<4&&<ArrowRight size={18}/>}</div>)}</div><p>The simulation runs in the Next.js API. Cloud sync uses an authenticated API and a user-scoped DynamoDB partition. Lesson diagrams describe reference architectures; selecting a lesson does not deploy it.</p></section><div className="aws-info-grid"><section className="info-card"><Zap size={23}/><h2>Lambda by default</h2><p>Use short, stateless handlers for bursty APIs, queue consumers, and projections. Bound concurrency to protect downstream resources.</p><small>No server fleet to maintain · pay per use</small></section><section className="info-card"><ServerIcon/><h2>EC2 when the machine matters</h2><p>Use long-lived application processes to study load balancing, connection state, cache coordination, leases, and custom partitioning.</p><small>Full control · capacity and patching are yours</small></section><section className="info-card"><Database size={23}/><h2>Managed data planes</h2><p>Keep replication, durable queues, identity, and storage managed. Self-host only when operating the mechanism is the lesson.</p><small>Less infrastructure work · service constraints remain</small></section></div><div className="section-heading"><h2>Every service has a lesson.</h2><span>56 CONCEPTS · 7 PATHS</span></div><div className="mapping-table-wrap"><table className="mapping-table"><thead><tr><th>Concept</th><th>Learning path</th><th>AWS implementation</th><th>Execution</th><th><span className="sr-only">Explore</span></th></tr></thead><tbody>{concepts.map(c=><tr key={c.id}><td><button onClick={()=>selectConcept(c)}>{c.title}</button></td><td>{groups.find(g=>g.id===c.group)?.name}</td><td>{c.service}</td><td><span className={`compute-tag ${c.compute.toLowerCase()}`}>{c.compute}</span></td><td><button className="icon-button" aria-label={`Explore ${c.title}`} onClick={()=>selectConcept(c)}><ArrowUpRight size={15}/></button></td></tr>)}</tbody></table></div><div className="setup-card"><Terminal size={22}/><div><h2>Ready to connect your own AWS account?</h2><p>Deploy <code>infra/template.yaml</code> with AWS SAM, then add its outputs to <code>.env.local</code>. The project README includes commands, security boundaries, and a complete concept mapping.</p><pre>cd infra{`\n`}sam build{`\n`}sam deploy --guided</pre><small>Deployment creates billable AWS resources. No infrastructure is created by using this playground.</small></div></div></>}
        {page==="progress"&&<><PageHeading kicker="A LITTLE MORE UNDERSTANDING, EVERY DAY" title="Your learning journey." description="Run an experiment, explain the trade-off, and mark the concept complete. Your progress stays in this browser unless you connect AWS."/><div className="progress-overview"><span className="big-progress">{completed.length}<small>/ 56</small></span><div><h2>{completed.length?"Keep connecting the dots.":"Your first experiment is waiting."}</h2><p>{completed.length===56?"You explored every concept. Revisit a path and change your assumptions.":`${56-completed.length} concepts left to explore, one experiment at a time.`}</p></div><Trophy size={44}/></div><div className="progress-paths">{groups.map(g=>{const list=concepts.filter(c=>c.group===g.id);const count=list.filter(c=>completed.includes(c.id)).length;const Icon=groupIcons[g.id];return <section key={g.id} className="path-progress"><Icon size={23}/><div><h2>{g.name}</h2><p>{g.subtitle}</p><span className="progress-track"><i style={{width:`${count/8*100}%`}}/></span></div><span>{count} / 8</span><button className="button" onClick={()=>selectConcept(list.find(c=>!completed.includes(c.id))??list[0])}>{count===8?"Revisit":"Explore"}<ArrowRight size={14}/></button></section>})}</div></>}
        <footer className="main-footer"><span>Built for the curious engineer.</span><a href="https://amankeshri.com" target="_blank" rel="noreferrer">Made with <Heart size={11}/><span className="sr-only">heart</span> by Aman<ArrowUpRight size={12}/></a><span>Learn locally. Build confidently.</span></footer>
      </main>
    </div>
    {notice&&<div className="toast" role="status"><Check size={17}/>{notice}<button className="icon-button" aria-label="Dismiss notification" onClick={()=>setNotice("")}><X size={14}/></button></div>}
    {help&&<dialog ref={helpDialogRef} className="modal-backdrop" onCancel={()=>setHelp(false)} onClick={()=>setHelp(false)}><section className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={e=>e.stopPropagation()}><button autoFocus className="icon-button modal-close" aria-label="Close help" onClick={()=>setHelp(false)}><X size={20}/></button><span className="category-icon"><FlaskConical size={27}/></span><h2 id="help-title">Small experiments. Lasting understanding.</h2><ol><li>Choose a concept from a learning path.</li><li>Adjust traffic, capacity, or the concept’s specific variable.</li><li>Run the simulation and follow the four-step request journey.</li><li>Change one variable, compare the outcome, and mark it complete.</li></ol><h3>What the numbers mean</h3><p>{result.assumptions}</p><p>All 56 concepts have guided traces and deterministic parameter models. The diagram shows a family-level reference topology. These are teaching tools, not emulators of all AWS service behavior.</p><button className="button primary" onClick={()=>setHelp(false)}>Let’s experiment<ArrowRight size={15}/></button></section></dialog>}
  </div>;
}
function ServerIcon(){return <Boxes size={23}/>;}
function PageHeading({kicker,title,description}:{kicker:string;title:string;description:string}){return <div className="page-heading standalone"><div><div className="eyebrow"><span className="blue-dash"/>{kicker}</div><h1>{title}</h1><p>{description}</p></div></div>;}
function Range({label,value,min,max,step,unit,onChange}:{label:string;value:number;min:number;max:number;step:number;unit:string;onChange:(n:number)=>void}){return <label className="range-control"><span>{label}<output>{format(value)} <small>{unit}</small></output></span><input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))} style={{"--range-progress":`${(value-min)/(max-min)*100}%`} as React.CSSProperties}/><span className="range-endpoints"><small>{format(min)}{unit&&` ${unit}`}</small><small>{format(max)}{unit&&` ${unit}`}</small></span></label>;}
function Metric({icon,label,value,unit,note,color,spark}:{icon:React.ReactNode;label:string;value:string;unit:string;note:string;color:string;spark:string}){return <section className={`metric-card ${color}`}><div className="metric-label">{icon}<span>{label}</span></div><div className="metric-value">{value}<small>{unit}</small><svg width="68" height="28" viewBox="0 0 84 32" aria-hidden="true"><polyline points={spark} fill="none" stroke="currentColor" strokeWidth="1.8"/></svg></div><p>{note}</p></section>;}
function LatencyChart({result,elapsed}:{result:SimulationResult;elapsed:number}){
 const points=result.points.slice(0,elapsed||24);const max=Math.max(120,...result.points.map(p=>p.latency))*1.1;
 const path=points.map((p,i)=>`${i===0?"M":"L"}${40+i/23*390},${110-p.latency/max*90}`).join(" ");
 return <svg className="latency-chart" viewBox="0 0 455 140" role="img" aria-label={`Modeled latency across ${elapsed||24} simulation steps`}><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#496cf5" stopOpacity=".14"/><stop offset="100%" stopColor="#496cf5" stopOpacity="0"/></linearGradient></defs>{[0,1,2,3].map(i=><g key={i}><line x1="40" y1={20+i*30} x2="438" y2={20+i*30} stroke="#e9edf3" strokeDasharray="3 4"/><text x="0" y={24+i*30}>{Math.round(max*(1-i/3))}</text></g>)}<path d={`${path} L${40+(points.length-1)/23*390},110 L40,110Z`} fill="url(#chart-fill)"/><path d={path} fill="none" stroke="#5270ef" strokeWidth="2.3"/>{[0,6,12,18,24].map(n=><text key={n} x={36+n/24*390} y="132">{n}</text>)}</svg>;
}
function analogy(concept:Concept){const analogies:Record<GroupId,string>={caching:"Your desk is the cache. Your bookshelf is the database. Keep what you reach for most within arm’s reach.",scaling:"One checkout lane can only move so fast. More lanes help, as long as someone directs the line.",data:"A library works because books have a place, a catalog, and sometimes more than one copy.",messaging:"A restaurant ticket rail lets orders arrive while the kitchen works at its own pace.",resilience:"A ship has watertight compartments so a leak in one section doesn’t sink the whole vessel.",security:"A building needs both an identity check at the door and permission to enter each room.",distributed:"A team in different time zones needs rules for decisions, updates, and handling disagreements."};return analogies[concept.group];}
function computeReason(concept:Concept){return concept.compute==="Lambda"?"Short, stateless work fits Lambda’s event-driven model. Use bounded concurrency, idempotent operations, and timeouts to protect dependencies.":concept.compute==="EC2"?"This lesson benefits from a long-lived process or direct control of instances. Use an isolated lab fleet and stop it when the experiment is finished.":"The managed service owns the core storage, identity, or delivery behavior. Use a small Lambda handler only when application logic is needed.";}

function sparkline(result:SimulationResult,key:"latency"|"throughput"|"value"){const values=result.points.map(p=>p[key]);const max=Math.max(1,...values);return values.map((value,i)=>`${i/23*84},${28-value/max*24}`).join(" ");}
