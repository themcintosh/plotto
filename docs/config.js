/* Settings for the public site.
 *
 * writerUrl: the address of your Google Apps Script web app (README: "Putting it on the web"). With it
 * set, visitors enter an email address and get a free interpretation on your Claude account. Leave it
 * empty to use the local server (python3 server.py) or, on claude.ai, the viewer's own Claude.
 */
window.PLOTTO_CONFIG = {
  writerUrl: "https://script.google.com/macros/s/AKfycbzjysxhdT7AtYveLLi1Qk3wE7he5XjvS-E46_PCQWQ-m6XPxf7M-t_G1R_XV7MnZvcG/exec",
  // The newsletter named in the notice under the email field, and an optional link for its name.
  newsletter: "Solution Space",
  newsletterUrl: "https://ideachemistry.substack.com/subscribe",
};
