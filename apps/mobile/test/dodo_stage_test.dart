import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/widgets/dashboard/dodo_stage.dart';

void main() {
  test('every visible linking step stays on screen for five seconds', () {
    expect(dodoLinkingStepMinimumHold, const Duration(seconds: 5));
  });

  test('Dodo owns two columns on desktop and stacks on smaller screens', () {
    expect(useDodoDesktopHeroLayout(1180), isTrue);
    expect(useDodoDesktopHeroLayout(849), isFalse);
    expect(useDodoWideSceneLayout(680), isTrue);
    expect(useDodoWideSceneLayout(390), isFalse);
    expect(dodoDesktopHeroHeight, 430);
  });

  test('linking Dodo stage follows the real connection process in order', () {
    expect(
      linkingDodoStageScenes.map((scene) => scene.action),
      [
        DodoStageAction.pendantListen,
        DodoStageAction.networkSearch,
        DodoStageAction.locationSearch,
        DodoStageAction.aiCheck,
      ],
    );
  });

  test('every Dodo action has a lightweight bundled image', () {
    final assets = DodoStageAction.values
        .map((action) => action.assetPath)
        .toSet();

    expect(assets, hasLength(DodoStageAction.values.length));
    expect(assets.every((asset) => asset.endsWith('.webp')), isTrue);
    expect(
      assets.every((asset) => asset.startsWith('assets/dodo/stages/')),
      isTrue,
    );
  });

  test('live artwork greets while process artwork remains fully visible', () {
    expect(DodoStageAction.idle.imageFit, BoxFit.cover);
    expect(DodoStageAction.idle.imageAlignment.y, lessThan(0));
    expect(DodoStageAction.networkSearch.imageFit, BoxFit.contain);
    expect(DodoStageAction.aiCheck.imageAlignment, Alignment.center);
    expect(DodoStageAction.aiCheck.shortLabel, 'GUARDIAN AI');
  });

  test('linking step selection is safely clamped', () {
    expect(
      dodoStageSceneForLinkingStep(-1).action,
      DodoStageAction.pendantListen,
    );
    expect(
      dodoStageSceneForLinkingStep(99).action,
      DodoStageAction.aiCheck,
    );
  });
}
