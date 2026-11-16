import { useEffect, useState } from 'react'
import { Activity, Bell, CheckCircle2, CloudUpload, Download, Film, FolderOpen, HardDrive, LayoutDashboard, LogOut, Menu, Settings, ShieldCheck, Upload, X } from 'lucide-react'

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4317'
const sizeLabel = n => n < 1024**2 ? (n/1024).toFixed(0)+' KB' : (n/1024**2).toFixed(1)+' MB'

function LoginScreen({ error }) {
  return <div className="login-shell">
    <div className="login-card">
      <div className="login-mark">J<span>.</span></div>
      <small className="overline">VIDEO WORKSPACE</small>
      <h1>JERUNG <i>STUDIO</i></h1>
      <p>Sign in to your private video workspace.</p>
      {error && <div className="login-error">Google sign-in could not be completed. Please try again.</div>}
      <button className="google-button" onClick={() => window.location.assign(`${API}/auth/google`)}>
        <span className="google-g">G</span> Continue with Google
      </button>
      <small className="login-foot"><ShieldCheck/> Secure Google authentication</small>
    </div>
    <div className="login-caption">BUILT FOR ORIGINAL QUALITY</div>
  </div>
}

export default function App() {
  const [file,setFile] = useState(null)
  const [navOpen,setNavOpen] = useState(false)
  const [user,setUser] = useState(null)
  const [authReady,setAuthReady] = useState(false)
  const [loginError,setLoginError] = useState(false)
  const [logoutBusy,setLogoutBusy] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setLoginError(params.get('login') === 'failed')
    if (params.has('login')) window.history.replaceState({}, '', window.location.pathname)
    fetch(`${API}/auth/me`, { credentials: 'include' })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Session check failed')))
      .then(data => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setAuthReady(true))
  }, [])

  const logout = async () => {
    setLogoutBusy(true)
    try {
      await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' })
      setUser(null)
      setFile(null)
    } finally {
      setLogoutBusy(false)
    }
  }

  const pick = f => { if(f) setFile(f) }
  if (!authReady) return <div className="login-shell"><div className="login-card"><div className="login-mark">J<span>.</span></div><p>Preparing your workspace…</p></div></div>
  if (!user) return <LoginScreen error={loginError}/>

  return <div className="shell">
    <aside className={navOpen?'sidebar open':'sidebar'}>
      <div className="brand"><div className="mark">J<span>.</span></div><div><b>JERUNG <i>STUDIO</i></b><small>VIDEO WORKSPACE</small></div><button className="close" onClick={()=>setNavOpen(false)}><X/></button></div>
      <small className="overline">WORKSPACE</small>
      <nav><a><LayoutDashboard/> Overview</a><a className="selected"><CloudUpload/> Upload video</a><a><FolderOpen/> Video library</a></nav>
      <div className="bottom"><div className="storage"><small><HardDrive/> STORAGE <em>FREE TIER</em></small><b>0 GB <span>of 10 GB</span></b><div className="track"></div><p>Cloud storage connects in Phase 2</p></div><a><Settings/> Settings</a><div className="user"><div>{user.picture?<img src={user.picture} alt="" />:(user.name||user.email||'U').slice(0,1).toUpperCase()}</div><section><b>{user.name||'Google user'}</b><small>{user.email}</small></section><button className="logout" title="Sign out" onClick={logout} disabled={logoutBusy}><LogOut/></button></div></div>
    </aside>
    <main>
      <header><button className="hamb" onClick={()=>setNavOpen(true)}><Menu/></button><div>Workspace <span>/</span> <b>Upload video</b></div><aside><label><i/> SIGNED IN</label><Bell/><div className="avatar">{user.picture?<img src={user.picture} alt="" />:(user.name||'U').slice(0,1).toUpperCase()}</div></aside></header>
      <div className="content">
        <div className="heading"><div><small className="overline">● CREATOR WORKSPACE</small><h1>Upload <i>video.</i></h1><p>Bring your original footage into one secure workspace.</p></div><label className="private"><ShieldCheck/> PRIVATE WORKSPACE</label></div>
        <section className="stats"><article><Film/><small>VIDEOS STORED</small><b>—</b><p>Awaiting storage setup</p></article><article><HardDrive/><small>STORAGE USED</small><b>—</b><p>R2 connection pending</p></article><article><Activity/><small>UPLOAD STATUS</small><b>Ready</b><p>Upload engine not connected</p></article></section>
        <section className="columns"><article className="panel"><div className="panelhead"><div><small>01 / ADD YOUR FOOTAGE</small><h2>Upload a video</h2></div><label>PHASE 1 DEMO</label></div>
          <div className="drop" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();pick(e.dataTransfer.files?.[0])}}>
            {file?<><CheckCircle2 className="ok"/><h3>File selected</h3><p>{file.name}</p><b>{sizeLabel(file.size)} · {file.type||'Video file'}</b><button className="secondary" onClick={()=>setFile(null)}>Remove file</button></>:<><CloudUpload className="cloud"/><h3>Drop your video here</h3><p>or select a file from your device</p><label className="primary"> <Upload/> Choose video<input type="file" accept=".mp4,.mov,video/mp4,video/quicktime" onChange={e=>pick(e.target.files?.[0])}/></label><small>MP4 · MOV &nbsp; / &nbsp; TARGET 100–500 MB</small></>}
          </div><p className="notice"><ShieldCheck/> <span><b>Your original stays untouched.</b> This screen currently previews the selected file locally. Real upload integration is still pending.</span></p>
        </article>
        <div className="right"><article className="panel"><div className="panelhead"><div><small>02 / FILE GUIDELINES</small><h2>Upload requirements</h2></div></div>{[['Supported formats','MP4 · MOV'],['Target file size','100–500 MB'],['Video processing','Original file'],['Resolution','Source preserved'],['Frame rate','Source preserved']].map(([a,b])=><div className="rule" key={a}><span>{a}</span><b>{b}</b></div>)}<p className="hint">No re-encoding in the upload pipeline.</p></article><article className="tip"><ShieldCheck/><div><b>Built for your originals.</b><p>Resumable uploads are planned so a weak connection won't force you to start over.</p></div></article></div></section>
        <section className="panel library"><div className="panelhead"><div><small>03 / YOUR CONTENT</small><h2>Recent videos</h2></div></div>{file?<div className="file"><Film/><div><b>{file.name}</b><small>{sizeLabel(file.size)} · Local preview only</small></div><label>NOT UPLOADED</label></div>:<div className="empty"><FolderOpen/><b>Your video library is waiting</b><p>Uploaded videos will appear here after cloud storage is connected.</p></div>}</section>
        <footer>JERUNG STUDIO · GOOGLE LOGIN ENABLED <span>BUILT FOR ORIGINAL QUALITY</span></footer>
      </div>
    </main>
  </div>
}
