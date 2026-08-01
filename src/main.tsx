import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// ─── Viewport Height Fix ─────────────────────────────────────────────────────
// `100dvh` is unreliable on mobile: when you switch apps and return, the
// browser chrome (address bar) may change size, but dvh doesn't always
// re-evaluate. We use visualViewport.height (or window.innerHeight as fallback)
// and write it to a CSS custom property that all game screens use instead.
function setAppHeight() {
  const height = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty('--app-height', `${height}px`);
}
setAppHeight();
window.visualViewport?.addEventListener('resize', setAppHeight);
window.visualViewport?.addEventListener('scroll', setAppHeight);
window.addEventListener('resize', setAppHeight);
// Also fire on focus (covers the "return from another app" scenario)
window.addEventListener('focus', setAppHeight);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') setAppHeight();
});
import { PostHogProvider } from '@posthog/react'

const options = {
  api_host: import.meta.env.VITE_POSTHOG_HOST,
  disable_session_recording: true,
  errorTracking: {
    autocapture: {
      uncaughtExceptions: true,
      unhandledRejections: true,
    },
  },
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PostHogProvider apiKey={import.meta.env.VITE_POSTHOG_PROJECT_TOKEN} options={options}>
      <App />
    </PostHogProvider>
  </StrictMode>,
)
