/**
 * Shared CORS / CSRF / frame allowlist for the API.
 */
export function getAllowedOrigins() {
  return [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://localhost:4174',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://localhost:5176',
    'http://localhost:5177',
    'https://asli-frontend.vercel.app',
    'https://aslilearn.ai',
    'https://www.aslilearn.ai',
    'https://api.aslilearn.ai',
    // Android / Expo WebView Origin (bundle id com.tech.aslilearnai)
    'https://com.tech.aslilearnai',
    'http://com.tech.aslilearnai',
    'capacitor://localhost',
    'ionic://localhost',
    'https://alsi-stud-frontend-mf3r-ampkob5el-akhilesh2006s-projects.vercel.app',
    'https://alsi-stud-frontend-mf3r-es6c3f5aq-akhilesh2006s-projects.vercel.app',
    'https://alsi-stud-frontend-mf3r-ea1jir1t6-akhilesh2006s-projects.vercel.app',
    'https://alsi-stud-frontend-mf3r-r50hrstmi-akhilesh2006s-projects.vercel.app',
    'https://alsi-stud-frontend-mf3r-12gsssa10-akhilesh2006s-projects.vercel.app',
    'https://alsi-stud-frontend-mf3r-gajkeubdu-akhilesh2006s-projects.vercel.app',
    'https://alsi-stud-frontend-mf3r-hugnvpnzk-akhilesh2006s-projects.vercel.app',
    'https://alsi-stud-frontend-mf3r-5i351br51-akhilesh2006s-projects.vercel.app',
    'https://alsi-stud-frontend-mf3r-6p7vghuuv-akhilesh2006s-projects.vercel.app',
    'https://alsi-stud-frontend-mf3r-9pn4j5v4f-akhilesh2006s-projects.vercel.app',
    'https://alsi-stud-frontend-mf3r-18qclrtbv-akhilesh2006s-projects.vercel.app',
    'https://alsi-stud-frontend-mf3r-mlmb076jn-akhilesh2006s-projects.vercel.app',
    'https://alsi-stud-frontend-mf3r-m8dmkdu86-akhilesh2006s-projects.vercel.app',
    'https://alsi-stud-frontend-mf3r.vercel.app',
    process.env.CLIENT_URL,
  ].filter(Boolean);
}
