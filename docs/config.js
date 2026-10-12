/* Settings for the public site.
 *
 * writerUrl: the address of your Google Apps Script web app (README: "Putting it on the web"). With it
 * set, visitors enter an email address and get a free interpretation on your Claude account. Leave it
 * empty to use the local server (python3 server.py) or, on claude.ai, the viewer's own Claude.
 */
window.PLOTTO_CONFIG = {
  writerUrl: "https://script.google.com/macros/s/AKfycbx638DiGa3imI3dLgtF-yl4bPDrf43hIFVqX5R1zUg/dev",
  // The newsletter named in the notice under the email field, and an optional link for its name.
  newsletter: "Solution Space",
  newsletterUrl: "https://ideachemistry.substack.com/subscribe",
};
