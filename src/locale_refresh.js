function refreshStaticMessages() {
CHAPTERS = [null, ['ENVIRONMENT', tr("m0001"), tr("m0002"), tr("m0003")], ['ACTOR / CRITIC', tr("m0004"), tr("m0005"), tr("m0006")], ['LEARNING SIGNAL', tr("m0007"), tr("m0008"), tr("m0009")], ['PPO UPDATE', tr("m0010"), tr("m0011"), tr("m0012")], ['INFERENCE / TEST', tr("m0013"), tr("m0014"), tr("m0015")]];PROFILE_LABELS = { nominal: tr("m0232"), push: tr("m0233"), wind: tr("m0234"), sensor: tr("m0235"), actuator: tr("m0236"), model: tr("m0237"), mixed: tr("m0238"), ood: tr("m0239"), randomized: tr("m0238") };
PLAN_LABELS = { fixed: tr("m0240"), ramp: tr("m0241"), staged: tr("m0242") };
SPEC_FIELDS = [
    ['mc', tr("m0243"), 'kg', .1, 10, .1, tr("m0244")],
    ['mp', tr("m0245"), 'kg', .02, 2, .01, tr("m0246")], ['l', tr("m0247"), 'm', .1, 1.5, .05, tr("m0248")],
    ['gravity', tr("m0249"), 'm/s²', 1, 20, .1, tr("m0250")], ['force', tr("m0251"), 'N', 1, 60, 1, tr("m0252")],
    ['ratio', tr("m0253"), tr("m0254"), 1, 8, .1, tr("m0255")], ['mu', tr("m0256"), '—', .1, 3, .1, tr("m0257")],
    ['modelSpread', tr("m0258"), tr("m0259"), 0, .5, .05, tr("m0260")], ['friction', tr("m0261"), 'N·s/m', 0, 2, .05, tr("m0262")],
    ['push', tr("m0263"), 'N', 0, 40, 1, tr("m0264")], ['pushMin', tr("m0265"), 's', .02, 2, .02, tr("m0266")], ['pushMax', tr("m0267"), 's', .02, 2, .02, tr("m0268")], ['pushPeriod', tr("m0269"), 's', .1, 10, .1, tr("m0270")],
    ['wind', tr("m0271"), 'N', 0, 15, .5, tr("m0272")], ['noise', tr("m0273"), tr("m0254"), 0, 10, .25, tr("m0274")],
    ['delay', tr("m0275"), 's', 0, .1, .02, tr("m0276")], ['lag', tr("m0277"), 's', 0, .1, .005, tr("m0278")], ['gainSpread', tr("m0279"), tr("m0259"), 0, .5, .05, tr("m0280")]
];
  extendCostFields();
}
