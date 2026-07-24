import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:model_viewer_plus/model_viewer_plus.dart';

import '../brand/dodo_ai_icon.dart';

enum DodoStageMode { active, offline, linking }

enum DodoStageAction {
  idle,
  pendantListen,
  aiCheck,
  whatsappUpdate,
  familyConfirm,
  linkingSearch,
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
          'assets/models/dodo/guardian_dodo_idle.glb',
        DodoStageAction.pendantListen =>
          'assets/models/dodo/guardian_dodo_pendant_listen.glb',
        DodoStageAction.aiCheck =>
          'assets/models/dodo/guardian_dodo_ai_check.glb',
        DodoStageAction.whatsappUpdate =>
          'assets/models/dodo/guardian_dodo_whatsapp_update.glb',
        DodoStageAction.familyConfirm =>
          'assets/models/dodo/guardian_dodo_family_confirm.glb',
        DodoStageAction.linkingSearch =>
          'assets/models/dodo/guardian_dodo_linking_search.glb',
      };

  String get semanticLabel => switch (this) {
        DodoStageAction.idle => 'Guardian Dodo calmly watching',
        DodoStageAction.pendantListen =>
          'Guardian Dodo listening to the pendant',
        DodoStageAction.aiCheck =>
          'Guardian Dodo checking the pendant update with AI',
        DodoStageAction.whatsappUpdate =>
          'Guardian Dodo preparing a WhatsApp update',
        DodoStageAction.familyConfirm =>
          'Guardian Dodo confirming the family update',
        DodoStageAction.linkingSearch =>
          'Guardian Dodo searching for the pendant',
      };
}

String dodoViewerAssetSource(
  String flutterAssetPath, {
  required bool isWeb,
}) {
  // Flutter Web serves application assets beneath an additional `assets/`
  // URL prefix. ModelViewer renders native HTML and does not resolve Flutter
  // asset keys for us, so the browser URL must be expanded explicitly.
  return isWeb ? 'assets/$flutterAssetPath' : flutterAssetPath;
}

const _activeScenes = <DodoStageScene>[
  DodoStageScene(
    action: DodoStageAction.pendantListen,
    title: 'Listening to the pendant',
    detail: 'Pendant signal received',
  ),
  DodoStageScene(
    action: DodoStageAction.aiCheck,
    title: 'Checking the latest update',
    detail: 'Claude-backed AI is reading the signal',
  ),
  DodoStageScene(
    action: DodoStageAction.whatsappUpdate,
    title: 'Preparing the WhatsApp update',
    detail: 'A clear family message is being prepared',
  ),
  DodoStageScene(
    action: DodoStageAction.familyConfirm,
    title: 'Family circle informed',
    detail: 'The latest update is ready for your family',
  ),
  DodoStageScene(
    action: DodoStageAction.idle,
    title: 'Watching quietly',
    detail: 'Every Guardian channel is ready',
  ),
];

const _offlineScenes = <DodoStageScene>[
  DodoStageScene(
    action: DodoStageAction.pendantListen,
    title: 'Listening for the pendant',
    detail: 'Guardian is keeping the reconnection channel open',
  ),
];

const _linkingScenes = <DodoStageScene>[
  DodoStageScene(
    action: DodoStageAction.linkingSearch,
    title: 'Scanning for the pendant',
    detail: 'Secure connection in progress',
  ),
];

List<DodoStageScene> dodoStageScenesFor(DodoStageMode mode) => switch (mode) {
      DodoStageMode.active => _activeScenes,
      DodoStageMode.offline => _offlineScenes,
      DodoStageMode.linking => _linkingScenes,
    };

class GuardianDodo3d extends StatelessWidget {
  const GuardianDodo3d({
    required this.action,
    required this.reduceMotion,
    super.key,
  });

  final DodoStageAction action;
  final bool reduceMotion;

  bool get _supportsModelViewer =>
      kIsWeb ||
      defaultTargetPlatform == TargetPlatform.android ||
      defaultTargetPlatform == TargetPlatform.iOS;

  @override
  Widget build(BuildContext context) {
    if (reduceMotion || !_supportsModelViewer) {
      return Semantics(
        image: true,
        label: action.semanticLabel,
        child: Image.asset(
          DodoAiIcon.assetPath,
          fit: BoxFit.contain,
          excludeFromSemantics: true,
        ),
      );
    }

    return Semantics(
      image: true,
      label: action.semanticLabel,
      child: IgnorePointer(
        child: ModelViewer(
          key: ValueKey(action.assetPath),
          src: dodoViewerAssetSource(action.assetPath, isWeb: kIsWeb),
          poster: dodoViewerAssetSource(
            DodoAiIcon.assetPath,
            isWeb: kIsWeb,
          ),
          alt: action.semanticLabel,
          backgroundColor: Colors.transparent,
          ar: false,
          autoPlay: true,
          autoRotate: false,
          cameraControls: false,
          disablePan: true,
          disableTap: true,
          disableZoom: true,
          cameraOrbit: '0deg 86deg 112%',
          fieldOfView: '28deg',
          environmentImage: 'neutral',
          exposure: 1.08,
          shadowIntensity: 0.28,
          shadowSoftness: 0.9,
          loading: Loading.eager,
          reveal: Reveal.auto,
          debugLogging: false,
        ),
      ),
    );
  }
}
