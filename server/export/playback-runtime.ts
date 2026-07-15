import { DEFAULT_PLAYBACK_SPEED } from '../../src/lib/replay/playback'

export function buildPlaybackRuntime({
  pauseIcon,
  playIcon,
}: {
  pauseIcon: string
  playIcon: string
}): string {
  return `(function () {
  var payloadEl = document.getElementById('replay-payload');
  if (!payloadEl) { return; }
  var payload = JSON.parse(payloadEl.textContent || '{}');
  var playbackTurns = payload.playbackTurns || [];
  var frames = (payload.playbackTimeline && payload.playbackTimeline.frames) || [];
  var frameIndex = frames.length === 0 ? 0 : Math.min(Math.max(payload.initialFrameIndex || 0, 0), frames.length - 1);
  var speeds = payload.speeds || [];
  var viewport = payload.viewport || {};
  var viewportStates = viewport.states || {};
  var playIcon = ${JSON.stringify(playIcon)};
  var pauseIcon = ${JSON.stringify(pauseIcon)};
  var defaultSpeedIndex = Math.max(speeds.indexOf(${DEFAULT_PLAYBACK_SPEED}), 0);
  var content = document.querySelector('[data-playback-content]');
  var stage = document.querySelector('[data-playback-stage]');
  var transcript = document.querySelector('[data-playback-transcript]');
  var playButton = document.querySelector('[data-action="toggle-play"]');
  var previousButton = document.querySelector('[data-action="prev"]');
  var nextButton = document.querySelector('[data-action="next"]');
  var speedButton = document.querySelector('[data-action="speed"]');
  var mode = frames.length === 0 ? 'idle' : 'paused';
  var speedIndex = defaultSpeedIndex;
  var timer = null;
  var initialScrollDone = false;
  var hasOverflow = false;
  var userDetached = false;
  var programmaticScrollActive = false;
  var programmaticScrollTimer = null;
  var userScrollIntent = false;
  var userScrollIntentTimer = null;
  var turnNodes = transcript ? Array.from(transcript.querySelectorAll('.replay-turn')) : [];
  var turnIndexById = {};
  for (var i = 0; i < playbackTurns.length; i++) {
    turnIndexById[playbackTurns[i].turnId] = i;
  }

  function currentFrame() { return frames[frameIndex] || null; }
  function currentTurnIndex() { var frame = currentFrame(); return frame ? frame.turnIndex : 0; }
  function clearTimer() {
    if (timer !== null) { window.clearTimeout(timer); timer = null; }
  }
  function clearProgrammaticScrollTracking() {
    programmaticScrollActive = false;
    if (programmaticScrollTimer !== null) {
      window.clearTimeout(programmaticScrollTimer);
      programmaticScrollTimer = null;
    }
  }
  function clearUserScrollIntent() {
    userScrollIntent = false;
    if (userScrollIntentTimer !== null) {
      window.clearTimeout(userScrollIntentTimer);
      userScrollIntentTimer = null;
    }
  }
  function resetViewport() {
    clearProgrammaticScrollTracking();
    clearUserScrollIntent();
    hasOverflow = false;
    userDetached = false;
  }
  function checkOverflow() {
    hasOverflow = Boolean(content && content.scrollHeight > content.clientHeight);
  }
  function deriveViewportState() {
    if (userDetached) { return viewportStates.detached; }
    if (hasOverflow) { return viewportStates.overflow; }
    return viewportStates.underflow;
  }
  function syncViewportState() {
    checkOverflow();
    if (stage) { stage.setAttribute('data-viewport-state', deriveViewportState()); }
  }
  function markUserScrollIntent() {
    userScrollIntent = true;
    if (userScrollIntentTimer !== null) { window.clearTimeout(userScrollIntentTimer); }
    userScrollIntentTimer = window.setTimeout(clearUserScrollIntent, viewport.userScrollIntentWindowMs);
  }
  function onContentScroll() {
    checkOverflow();
    if (!hasOverflow || userDetached || programmaticScrollActive || !userScrollIntent) { return; }
    clearUserScrollIntent();
    userDetached = true;
    sync();
  }
  function withProgrammaticScroll(scroll) {
    programmaticScrollActive = true;
    scroll();
    if (programmaticScrollTimer !== null) { window.clearTimeout(programmaticScrollTimer); }
    programmaticScrollTimer = window.setTimeout(clearProgrammaticScrollTracking, viewport.programmaticScrollGuardMs);
  }
  function resetPlayback() {
    resetViewport();
    frameIndex = 0;
  }
  function shouldDisplayTurn(index) { return mode === 'idle' || index <= currentTurnIndex(); }
  function findTurnNode(targetIndex) {
    for (var index = 0; index < turnNodes.length; index++) {
      if (Number(turnNodes[index].dataset.turnIndex || '-1') === targetIndex) { return turnNodes[index]; }
    }
    return null;
  }
  function syncTurnUnits(node, playbackIndex) {
    var frame = currentFrame();
    var turnIndex = currentTurnIndex();
    var playbackStarted = mode !== 'idle';
    var playbackTurn = playbackIndex !== undefined ? playbackTurns[playbackIndex] : undefined;
    var isPast = playbackStarted && playbackIndex !== undefined && playbackIndex < turnIndex;
    var isActive = playbackStarted && playbackIndex === turnIndex;
    var revealAll = !playbackStarted || !playbackTurn || isPast || (isActive && playbackTurn.role === 'user');
    var visibleCount = isActive && frame ? frame.revealedUnitCount : 0;
    var visibleUnitIds = revealAll
      ? new Set((playbackTurn ? playbackTurn.units : []).map(function (unit) { return unit.id; }))
      : new Set((playbackTurn ? playbackTurn.units.slice(0, visibleCount) : []).map(function (unit) { return unit.id; }));
    var activeUnitId = isActive && frame ? frame.activeUnitId : null;

    node.querySelectorAll('.replay-playback-unit').forEach(function (unitNode) {
      var unitId = unitNode.dataset.replayUnitId || '';
      var isVisible = revealAll || visibleUnitIds.has(unitId);
      unitNode.hidden = !isVisible;
      unitNode.classList.toggle('is-active', Boolean(activeUnitId === unitId));
      unitNode.classList.toggle('is-revealed', Boolean(isActive && visibleUnitIds.has(unitId)));
    });
    node.querySelectorAll('[data-replay-group-ids]').forEach(function (groupNode) {
      var ids = (groupNode.dataset.replayGroupIds || '').split(',').filter(Boolean);
      groupNode.hidden = !revealAll && ids.every(function (id) { return !visibleUnitIds.has(id); });
    });
  }
  function sync() {
    var turnIndex = currentTurnIndex();
    var activeTurnId = playbackTurns[turnIndex] ? playbackTurns[turnIndex].turnId : null;
    turnNodes.forEach(function (node) {
      var playbackIndex = turnIndexById[node.dataset.turnId || ''];
      node.hidden = playbackIndex !== undefined ? !shouldDisplayTurn(playbackIndex) : mode !== 'idle';
      node.classList.toggle('is-playback-past', mode !== 'idle' && playbackIndex !== undefined && playbackIndex < turnIndex);
      node.classList.toggle('is-playback-active', mode !== 'idle' && playbackIndex === turnIndex);
      syncTurnUnits(node, playbackIndex);
    });
    if (playButton) {
      var isPlaying = mode === 'playing';
      playButton.innerHTML = isPlaying ? pauseIcon : playIcon;
      playButton.setAttribute('aria-label', isPlaying ? 'Pause playback' : 'Play transcript');
      playButton.classList.toggle('preview-block__action--active', isPlaying);
      playButton.disabled = frames.length === 0;
    }
    if (previousButton) { previousButton.disabled = frameIndex === 0; }
    if (nextButton) { nextButton.disabled = frames.length === 0; }
    if (speedButton) {
      var speed = speeds[speedIndex] || 1;
      speedButton.textContent = speed + 'x';
      speedButton.setAttribute('aria-label', 'Playback speed ' + speed + 'x');
    }
    window.requestAnimationFrame(function () {
      if (!content) { return; }
      syncViewportState();
      if (!initialScrollDone) {
        var initialNode = findTurnNode(Math.min(turnIndex, Math.max(0, turnNodes.length - 1)));
        if (initialNode && deriveViewportState() !== viewportStates.underflow) {
          var initialBottom = initialNode.offsetTop + initialNode.offsetHeight;
          withProgrammaticScroll(function () {
            content.scrollTo({ behavior: 'auto', top: Math.max(0, initialBottom - Math.max(0, content.clientHeight - 160)) });
          });
        }
        initialScrollDone = true;
        return;
      }
      if (mode === 'idle' || deriveViewportState() === viewportStates.underflow || userDetached) { return; }
      var activeIndex = activeTurnId !== null ? turnIndexById[activeTurnId] : undefined;
      var activeNode = activeIndex !== undefined ? findTurnNode(activeIndex) : null;
      if (!activeNode) { return; }
      var activeBottom = activeNode.offsetTop + activeNode.offsetHeight;
      withProgrammaticScroll(function () {
        content.scrollTo({ behavior: 'auto', top: Math.max(0, activeBottom - Math.max(0, content.clientHeight - 160)) });
      });
    });
  }
  function schedulePlayback() {
    clearTimer();
    if (mode !== 'playing') { return; }
    var frame = currentFrame();
    var delayMs = frame ? frame.delayBySpeed[String(speeds[speedIndex] || 1)] : null;
    if (delayMs === null || delayMs === undefined) { mode = 'paused'; sync(); return; }
    timer = window.setTimeout(function () {
      if (frameIndex >= frames.length - 1) { mode = 'paused'; sync(); return; }
      frameIndex += 1;
      sync();
      schedulePlayback();
    }, delayMs);
  }
  if (playButton) {
    playButton.addEventListener('click', function () {
      if (mode === 'playing') { clearTimer(); mode = 'paused'; sync(); return; }
      if (frames.length === 0) { return; }
      if (frameIndex >= frames.length - 1) { resetPlayback(); }
      mode = 'playing';
      sync();
      schedulePlayback();
    });
  }
  if (previousButton) {
    previousButton.addEventListener('click', function () {
      if (frameIndex === 0) { return; }
      clearTimer();
      mode = 'paused';
      frameIndex -= 1;
      sync();
    });
  }
  if (nextButton) {
    nextButton.addEventListener('click', function () {
      if (frames.length === 0) { return; }
      clearTimer();
      mode = 'paused';
      if (frameIndex >= frames.length - 1) { resetPlayback(); sync(); return; }
      frameIndex += 1;
      sync();
    });
  }
  if (speedButton) {
    speedButton.addEventListener('click', function () {
      speedIndex = (speedIndex + 1) % speeds.length;
      sync();
      if (mode === 'playing') { schedulePlayback(); }
    });
  }
  if (content) {
    content.addEventListener('scroll', onContentScroll);
    content.addEventListener('pointerdown', markUserScrollIntent);
    content.addEventListener('touchstart', markUserScrollIntent);
    content.addEventListener('wheel', markUserScrollIntent);
  }
  sync();
}())`
}
