import 'package:flutter/material.dart';
import 'package:guardian/theme/colors.dart';

enum DodoStageMode { active, offline, linking }

const dodoLinkingStepMinimumHold = Duration(seconds: 5);
const dodoDesktopHeroMinimumWidth = 850.0;
const dodoWideSceneMinimumWidth = 680.0;
const dodoDesktopHeroHeight = 300.0;
const dodoCompactStageHeight = 220.0;
const dodoDesktopStageFlex = 48;
const dodoDesktopStatusFlex = 52;

bool useDodoDesktopHeroLayout(double width) =>
    width >= dodoDesktopHeroMinimumWidth;

bool useDodoWideSceneLayout(double width) => width >= dodoWideSceneMinimumWidth;

enum DodoStageAction {
  idle,
  pendantListen,
  networkSearch,
  locationSearch,
  aiCheck,
}

class DodoStageScene {
  const DodoStageScene({
    required this.action,
    required this.title,
    required this.detail,
  });

  final DodoStageAction action;
  final String title;
  final String detail;
}

extension DodoStageActionPresentation on DodoStageAction {
  String get assetPath => switch (this) {
        DodoStageAction.idle =>
          'assets/dodo/stages/guardian_dodo_live.png',
        DodoStageAction.pendantListen =>
          'assets/dodo/stages/guardian_dodo_pendant.png',
        DodoStageAction.networkSearch =>
          'assets/dodo/stages/guardian_dodo_network.png',
        DodoStageAction.locationSearch =>
          'assets/dodo/stages/guardian_dodo_location.png',
        DodoStageAction.aiCheck =>
          'assets/dodo/stages/guardian_dodo_ai.png',
      };

  String get semanticLabel => switch (this) {
        DodoStageAction.idle => 'Guardian Dodo is live and ready',
        DodoStageAction.pendantListen =>
          'Guardian Dodo is listening for the pendant',
        DodoStageAction.networkSearch =>
          'Guardian Dodo is searching for the mobile network',
        DodoStageAction.locationSearch =>
          'Guardian Dodo is finding the pendant location',
        DodoStageAction.aiCheck =>
          'Guardian Dodo is checking the pendant update with AI',
      };

  BoxFit get imageFit => BoxFit.contain;

  Alignment get imageAlignment => Alignment.center;

  String get shortLabel => switch (this) {
        DodoStageAction.idle => 'LIVE',
        DodoStageAction.pendantListen => 'PENDANT',
        DodoStageAction.networkSearch => 'NETWORK',
        DodoStageAction.locationSearch => 'LOCATION',
        DodoStageAction.aiCheck => 'GUARDIAN AI',
      };
}

const _liveScene = DodoStageScene(
  action: DodoStageAction.idle,
  title: 'Guardian is live',
  detail: 'Every channel is ready',
);

const _offlineScene = DodoStageScene(
  action: DodoStageAction.pendantListen,
  title: 'Listening for the pendant',
  detail: 'Keeping the reconnection channel open',
);

const linkingDodoStageScenes = <DodoStageScene>[
  DodoStageScene(
    action: DodoStageAction.pendantListen,
    title: 'Listening for the pendant',
    detail: 'Waiting for the first signal',
  ),
  DodoStageScene(
    action: DodoStageAction.networkSearch,
    title: 'Finding the network',
    detail: 'Making a secure connection',
  ),
  DodoStageScene(
    action: DodoStageAction.locationSearch,
    title: 'Finding the location',
    detail: 'Checking GPS and nearby signals',
  ),
  DodoStageScene(
    action: DodoStageAction.aiCheck,
    title: 'Guardian AI is checking',
    detail: 'Preparing the first trusted update',
  ),
];

DodoStageScene dodoStageSceneForLinkingStep(int step) {
  return linkingDodoStageScenes[
      step.clamp(0, linkingDodoStageScenes.length - 1)];
}

DodoStageScene dodoStageSceneForMode(DodoStageMode mode) => switch (mode) {
      DodoStageMode.active => _liveScene,
      DodoStageMode.offline => _offlineScene,
      DodoStageMode.linking => linkingDodoStageScenes.first,
    };

class GuardianDodoStageImage extends StatelessWidget {
  const GuardianDodoStageImage({
    required this.action,
    super.key,
  });

  final DodoStageAction action;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      image: true,
      label: action.semanticLabel,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
        child: DecoratedBox(
          decoration: BoxDecoration(
            boxShadow: [
              BoxShadow(
                color: GuardianColors.safe.withValues(alpha: 0.14),
                blurRadius: 28,
                offset: const Offset(0, 14),
              ),
            ],
          ),
          child: Image.asset(
            action.assetPath,
            fit: action.imageFit,
            alignment: action.imageAlignment,
            excludeFromSemantics: true,
            filterQuality: FilterQuality.high,
            errorBuilder: (context, error, stackTrace) => const Center(
              child: Icon(
                Icons.shield_outlined,
                size: 54,
                color: Color(0xFF367A5D),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
