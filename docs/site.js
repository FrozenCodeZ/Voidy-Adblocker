// The page's one moment of motion: shortly after the page appears, Voidy pulls
// the clutter around it into the black hole. Clicking the black hole brings the
// clutter back and runs it again.
(() => {
  const hole = document.querySelector(".hole");
  if (!hole) return;
  const run = () => { hole.classList.remove("eaten"); void hole.offsetWidth; hole.classList.add("eaten"); };
  setTimeout(run, 900);
  hole.addEventListener("click", run);
})();
