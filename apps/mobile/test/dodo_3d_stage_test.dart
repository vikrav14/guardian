import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/widgets/dashboard/dodo_3d_stage.dart';

void main() {
  test('active Dodo stage tells the Guardian communications story in order', () {
    final actions = dodoStageScenesFor(
      DodoStageMode.active,
    ).map((scene) => scene.action);

    expect(
      actions,
      [
        DodoStageAction.pendantListen,
        DodoStageAction.aiCheck,
        DodoStageAction.whatsappUpdate,
        DodoStageAction.familyConfirm,
        DodoStageAction.idle,
      ],
    );
  });

  test('linking and offline modes stay on their purposeful actions', () {
    expect(
      dodoStageScenesFor(DodoStageMode.linking).single.action,
      DodoStageAction.linkingSearch,
    );
    expect(
      dodoStageScenesFor(DodoStageMode.offline).single.action,
      DodoStageAction.pendantListen,
    );
  });

  test('every Dodo action has a distinct bundled GLB asset', () {
    final assets = DodoStageAction.values
        .map((action) => action.assetPath)
        .toSet();

    expect(assets, hasLength(DodoStageAction.values.length));
    expect(assets.every((asset) => asset.endsWith('.glb')), isTrue);
    expect(
      assets.every((asset) => asset.startsWith('assets/models/dodo/')),
      isTrue,
    );
  });

  test('Dodo viewer expands Flutter asset keys for the browser', () {
    const asset = 'assets/models/dodo/guardian_dodo_idle.glb';

    expect(
      dodoViewerAssetSource(asset, isWeb: true),
      'assets/assets/models/dodo/guardian_dodo_idle.glb',
    );
    expect(dodoViewerAssetSource(asset, isWeb: false), asset);
  });
}
