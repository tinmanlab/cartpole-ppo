// Small additions to the existing viewer, not a second simulation or renderer.
function extendCostFields() {
  for (const key of ['rewardPosition', 'rewardVelocity', 'rewardAngle']) {
    if (SPEC_FIELDS.some(row => row[0] === key)) continue;
    const part = {rewardPosition:'position', rewardVelocity:'velocity', rewardAngle:'angle'}[key];
    SPEC_FIELDS.push([key,tr('cost.'+part),'coefficient',0,
      {rewardPosition:3,rewardVelocity:1,rewardAngle:5}[key],.01,tr('cost.'+part+'.help')]);
  }
}
function markActiveFields() {
  if (!$('specProfile')) return;
  const profile = $('specProfile').value, all = $('specPlan').value==='staged' || profile==='mixed';
  const groups = {model:['modelSpread','friction'],push:['push','pushMin','pushMax','pushPeriod'],wind:['wind'],sensor:['noise'],actuator:['delay','lag','gainSpread']};
  for (const [kind, fields] of Object.entries(groups)) for (const field of fields) {
    const input = $('spec_'+field); if (!input) continue;
    const inactive = !all && profile!==kind;
    input.disabled = inactive;
    input.closest('label').classList.toggle('inactive-field',inactive);
  }
}
function policyLabelForEvaluation() {
  return S.evalMeta ? `${sourceName(S.evalMeta.policySource)} I.${S.evalMeta.policyIteration}` : '';
}
function testConditionName(key) { return tr('probe.condition.'+key); }
function setInterfaceLanguage(language) {
  if (language===I18n.language) return;
  // A translation re-render must preserve the draft, including invalid unsaved
  // numeric text, as well as learner weights, clocks and all selected samples.
  const wasOpen=$('conditions').open;
  const raw=wasOpen?Object.fromEntries([...$('conditions').querySelectorAll('input,select')].map(el=>[el.id,el.value])):null;
  const settingsOpen=$('trainingSettings')?.open;
  I18n.setLanguage(language);
  try { localStorage.setItem('ppo-studio.locale',language); } catch (_) {}
  try { const url=new URL(location.href);url.searchParams.set('lang',language);history.replaceState(null,'',url); } catch (_) {}
  localizeStatic();refreshStaticMessages();
  if(wasOpen)$('conditions').close();
  updateHardwareReadout.identity=null;
  render();updateHardwareReadout();
  if(settingsOpen&&$('trainingSettings'))$('trainingSettings').open=true;
  if(wasOpen){openConditions();for(const [id,value] of Object.entries(raw))if($(id))$(id).value=value;renderDraftFacts();}
}
function initPublicUI() {
  extendCostFields();
  $('language').onchange=e=>setInterfaceLanguage(e.target.value);
  $('inspectExample').onclick=()=>{chooseSource('example');setChapter(2);$('quickstart').hidden=true;};
  $('openLearner').onclick=()=>{setChapter(5);$('quickstart').hidden=true;};
  $('dismissGuide').onclick=()=>{$('quickstart').hidden=true;};
}
