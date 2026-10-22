/**
 * "Sign in with GitHub" in a popup. `getUrl` resolves to GitHub's authorize URL (from
 * /api/deploy/github-oauth/start). The popup is opened before that request so pop-up blockers
 * still see it as a response to the click.
 *
 * Resolves to { ok: true, login } when the callback page reports success, or { closed: true } when
 * the window is closed first (re-check the account: the sign-in may still have finished).
 */
export function signInWithGithub(getUrl) {
  const w = 620
  const h = 760
  const left = Math.max(0, window.screenX + (window.outerWidth - w) / 2)
  const top = Math.max(0, window.screenY + (window.outerHeight - h) / 2)
  const popup = window.open('', 'autodeploy-github', `width=${w},height=${h},left=${left},top=${top}`)
  if (!popup) return Promise.reject(new Error('Your browser blocked the GitHub window. Allow pop-ups for this site and try again.'))
  popup.document.title = 'Connecting to GitHub…'

  return new Promise((resolve, reject) => {
    let timer = null
    const done = (fn, value) => {
      window.removeEventListener('message', onMessage)
      clearInterval(timer)
      fn(value)
    }
    const onMessage = (e) => {
      if (e.origin !== window.location.origin || e.data?.type !== 'autodeploy:github-connected') return
      if (e.data.ok) done(resolve, { ok: true, login: e.data.login })
      else done(reject, new Error(e.data.error || 'GitHub sign-in failed.'))
    }
    window.addEventListener('message', onMessage)
    timer = setInterval(() => { if (popup.closed) done(resolve, { closed: true }) }, 700)

    Promise.resolve(getUrl()).then((url) => {
      popup.location.href = url
    }).catch((err) => {
      popup.close()
      done(reject, err)
    })
  })
}
