// Runs in <head> before first paint so visitors who picked a mode don't see a flash.
// Signed-in users get their saved mode rendered by the server instead.
(function () {
    var root = document.documentElement;
    root.classList.add("js"); // lets CSS hide scroll-reveal content only when the script that reveals it runs
    if (root.hasAttribute("data-user-mode")) return;
    try {
        var saved = localStorage.getItem("paylog-mode");
        if (saved === "light" || saved === "dark") root.setAttribute("data-mode", saved);
    } catch (e) { /* storage unavailable: keep system default */ }
})();
