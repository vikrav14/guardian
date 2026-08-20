import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../services/avatar_image_loader.dart';
import '../services/avatar_image_strategy.dart';
import '../services/avatar_storage_urls.dart';
import '../services/guardian_services.dart';
import '../theme/app_theme.dart';
import 'navigation/guardian_navigation.dart';

/// Live guardian profile avatar for headers — listens to Firestore avatarUrl.
class GuardianHeaderAvatar extends StatefulWidget {
  const GuardianHeaderAvatar({
    super.key,
    required this.initials,
    required this.color,
    this.size = 36,
    this.avatarUrls,
  });

  final String initials;
  final Color color;
  final double size;
  final Stream<String?>? avatarUrls;

  @override
  State<GuardianHeaderAvatar> createState() => _GuardianHeaderAvatarState();
}

class _GuardianHeaderAvatarState extends State<GuardianHeaderAvatar> {
  late final Stream<String?> _avatarStream;

  @override
  void initState() {
    super.initState();
    _avatarStream = widget.avatarUrls ?? UserProfileService().watchAvatarUrl();
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<String?>(
      stream: _avatarStream,
      builder: (context, snapshot) {
        return AvatarBubble(
          initials: widget.initials,
          color: widget.color,
          size: widget.size,
          imageUrl: snapshot.data,
        );
      },
    );
  }
}

class AvatarBubble extends StatelessWidget {
  const AvatarBubble({
    super.key,
    required this.initials,
    required this.color,
    this.size = 32,
    this.ringWidth = 2.5,
    this.imageUrl,
  });

  final String initials;
  final Color color;
  final double size;
  final double ringWidth;
  final String? imageUrl;

  Widget _fallback(BuildContext context) {
    final surface = context.guardianColors.surface;
    return ColoredBox(
      color: surface,
      child: Center(
        child: Text(
          initials,
          style: TextStyle(
            fontSize: size * 0.34,
            fontWeight: FontWeight.w600,
            color: color,
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final url = imageUrl?.trim();
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: colors.surface,
        border: Border.all(color: color, width: ringWidth),
      ),
      padding: EdgeInsets.all(ringWidth),
      child: ClipOval(
        child: url == null || url.isEmpty
            ? _fallback(context)
            : _AvatarImage(
                key: ValueKey(url),
                url: url,
                size: size,
                fallback: _fallback(context),
              ),
      ),
    );
  }
}

class _AvatarImage extends StatefulWidget {
  const _AvatarImage({
    super.key,
    required this.url,
    required this.size,
    required this.fallback,
  });

  final String url;
  final double size;
  final Widget fallback;

  @override
  State<_AvatarImage> createState() => _AvatarImageState();
}

class _AvatarImageState extends State<_AvatarImage> {
  Uint8List? _authBytes;
  var _authLoadFinished = false;
  var _authLoadInFlight = false;
  var _networkLoadFailed = false;
  StreamSubscription<User?>? _authSubscription;

  bool get _usesFirebaseStorage => isFirebaseStorageMediaUrl(widget.url);

  bool get _useWebHtmlElement => shouldPreferWebHtmlElementAvatar(widget.url);

  /// Auth-only Firebase Storage URLs need the SDK. Token URLs on web are shown
  /// via [WebHtmlElementStrategy.prefer] because XHR/`getData()` need CORS.
  bool get _needsSdkLoad => shouldLoadAvatarBytesViaSdk(widget.url);

  @override
  void initState() {
    super.initState();
    if (_needsSdkLoad && _firebaseReady()) {
      _authSubscription = FirebaseAuth.instance.authStateChanges().listen((
        user,
      ) {
        if (_authBytes != null || !mounted || user == null) return;
        _authLoadFinished = false;
        _authLoadInFlight = false;
        unawaited(_loadWithAuth());
      });
    }
    if (_needsSdkLoad) {
      unawaited(_loadWithAuth());
    }
  }

  @override
  void didUpdateWidget(covariant _AvatarImage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.url != widget.url) {
      _authBytes = null;
      _authLoadFinished = false;
      _authLoadInFlight = false;
      _networkLoadFailed = false;
      if (_needsSdkLoad) {
        unawaited(_loadWithAuth());
      }
    }
  }

  @override
  void dispose() {
    _authSubscription?.cancel();
    super.dispose();
  }

  Future<void> _loadWithAuth() async {
    if (!_needsSdkLoad || _authLoadInFlight || !mounted) return;
    if (_authBytes != null) return;
    if (!_firebaseReady()) {
      if (mounted) {
        setState(() => _authLoadFinished = true);
      }
      return;
    }

    _authLoadInFlight = true;
    if (kDebugMode) {
      debugPrint('Avatar SDK load started for ${widget.url}');
    }
    Uint8List? bytes;
    try {
      bytes = await loadAvatarImageBytes(widget.url);
    } catch (error, stackTrace) {
      if (kDebugMode) {
        debugPrint(
          'Avatar SDK load threw for ${widget.url}: $error\n$stackTrace',
        );
      }
    }
    if (!mounted) return;

    _authLoadInFlight = false;
    _authLoadFinished = true;
    if (bytes == null || bytes.isEmpty) {
      if (kDebugMode) {
        debugPrint('Avatar SDK load failed for ${widget.url}');
      }
      setState(() {});
      return;
    }
    if (kDebugMode) {
      debugPrint('Avatar SDK load succeeded (${bytes.length} bytes)');
    }
    setState(() => _authBytes = bytes);
  }

  Future<void> _retrySdkAfterNetworkFailure() async {
    if (!_usesFirebaseStorage ||
        _authBytes != null ||
        _authLoadInFlight ||
        _authLoadFinished) {
      return;
    }
    await _loadWithAuth();
  }

  bool _firebaseReady() {
    try {
      Firebase.app();
      return true;
    } catch (_) {
      return false;
    }
  }

  Widget _loadingPlaceholder() {
    return SizedBox(width: widget.size, height: widget.size);
  }

  Widget _networkImage() {
    final strategy = webHtmlElementStrategyForAvatar(widget.url);
    if (kDebugMode && strategy == WebHtmlElementStrategy.prefer) {
      debugPrint('Avatar web HTML-element load for ${widget.url}');
    }
    return Image.network(
      widget.url,
      width: widget.size,
      height: widget.size,
      fit: BoxFit.cover,
      gaplessPlayback: true,
      webHtmlElementStrategy: strategy,
      loadingBuilder: (context, child, loadingProgress) {
        if (loadingProgress == null) return child;
        return _loadingPlaceholder();
      },
      errorBuilder: (_, error, stackTrace) {
        if (kDebugMode) {
          debugPrint('Avatar network load failed for ${widget.url}: $error');
        }
        if (_usesFirebaseStorage &&
            !_networkLoadFailed &&
            !_useWebHtmlElement) {
          _networkLoadFailed = true;
          unawaited(_retrySdkAfterNetworkFailure());
        }
        if (_authBytes != null) {
          return Image.memory(
            _authBytes!,
            width: widget.size,
            height: widget.size,
            fit: BoxFit.cover,
            gaplessPlayback: true,
            errorBuilder: (_, error, stackTrace) => widget.fallback,
          );
        }
        if (_usesFirebaseStorage && !_authLoadFinished) {
          return _loadingPlaceholder();
        }
        return widget.fallback;
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_authBytes != null) {
      return Image.memory(
        _authBytes!,
        width: widget.size,
        height: widget.size,
        fit: BoxFit.cover,
        gaplessPlayback: true,
        errorBuilder: (_, error, stackTrace) {
          if (kDebugMode) {
            debugPrint('Avatar memory image failed for ${widget.url}: $error');
          }
          return widget.fallback;
        },
      );
    }

    if (_useWebHtmlElement) {
      return _networkImage();
    }

    if (_needsSdkLoad) {
      if (!_authLoadFinished) {
        return _loadingPlaceholder();
      }
      return widget.fallback;
    }

    return _networkImage();
  }
}

class PhotoManagementControls extends StatelessWidget {
  const PhotoManagementControls({
    super.key,
    required this.subjectName,
    required this.hasPhoto,
    required this.onChange,
    required this.onRemove,
    this.busy = false,
  });

  final String subjectName;
  final bool hasPhoto;
  final VoidCallback onChange;
  final VoidCallback onRemove;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final accent = context.guardianColors.accent;
    final actionStyle = TextButton.styleFrom(foregroundColor: accent);
    return Wrap(
      alignment: WrapAlignment.center,
      spacing: GuardianSpacing.xxs,
      children: [
        Semantics(
          button: true,
          label: '${hasPhoto ? 'Change' : 'Add'} photo for $subjectName',
          excludeSemantics: true,
          child: TextButton.icon(
            onPressed: busy ? null : onChange,
            style: actionStyle,
            icon: const Icon(Icons.photo_library_outlined, size: 17),
            label: Text(hasPhoto ? 'Change photo' : 'Add photo'),
          ),
        ),
        if (hasPhoto)
          Semantics(
            button: true,
            label: 'Remove photo for $subjectName',
            excludeSemantics: true,
            child: TextButton(
              onPressed: busy ? null : onRemove,
              style: actionStyle,
              child: const Text('Remove photo'),
            ),
          ),
      ],
    );
  }
}

/// Section heading used on dashboard, account, and settings-style screens.
class GuardianSectionTitle extends StatelessWidget {
  const GuardianSectionTitle(this.title, {super.key});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Text(
      title,
      style: Theme.of(
        context,
      ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
    );
  }
}

/// Bordered surface card for grouped list rows (settings, people, devices).
class GuardianListGroup extends StatelessWidget {
  const GuardianListGroup({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: colors.border),
        boxShadow: [
          BoxShadow(
            color: GuardianColors.forest.withValues(alpha: 0.055),
            blurRadius: 28,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Column(children: children),
    );
  }
}

class GuardianSettingsRow extends StatelessWidget {
  const GuardianSettingsRow({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
    this.trailing,
    this.danger = false,
    this.showDivider = true,
  });

  final IconData icon;
  final String label;
  final String? trailing;
  final bool danger;
  final bool showDivider;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final iconColor = danger ? GuardianColors.danger : colors.textSecondary;
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: GuardianSpacing.sm,
          vertical: GuardianSpacing.sm,
        ),
        decoration: BoxDecoration(
          border: showDivider
              ? Border(bottom: BorderSide(color: colors.border))
              : null,
        ),
        child: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: danger ? GuardianColors.dangerBg : colors.accentMuted,
                borderRadius: BorderRadius.circular(13),
              ),
              child: Icon(icon, size: 19, color: iconColor),
            ),
            const SizedBox(width: GuardianSpacing.sm),
            Expanded(
              child: Text(
                label,
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontSize: 13,
                  fontWeight: FontWeight.normal,
                  color: danger ? GuardianColors.danger : colors.textPrimary,
                ),
              ),
            ),
            if (trailing != null)
              Text(
                trailing!,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: colors.accent,
                  fontWeight: FontWeight.w600,
                ),
              )
            else if (!danger)
              Icon(Icons.chevron_right, size: 16, color: colors.textMuted),
          ],
        ),
      ),
    );
  }
}

enum PillTone { safe, warning, danger, neutral }

class StatusPill extends StatelessWidget {
  const StatusPill({super.key, required this.label, required this.tone});

  final String label;
  final PillTone tone;

  (Color bg, Color fg) _colors(BuildContext context) {
    final colors = context.guardianColors;
    switch (tone) {
      case PillTone.safe:
        return (colors.accentMuted, colors.accent);
      case PillTone.warning:
        return (GuardianColors.warningBg, GuardianColors.warningText);
      case PillTone.danger:
        return (GuardianColors.dangerBg, GuardianColors.dangerText);
      case PillTone.neutral:
        return (colors.surfaceMuted, colors.textSecondary);
    }
  }

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = _colors(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        label,
        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: fg),
      ),
    );
  }
}

class StatTile extends StatelessWidget {
  const StatTile({
    super.key,
    required this.icon,
    required this.value,
    this.iconColor,
  });

  final IconData icon;
  final String value;
  final Color? iconColor;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10),
      decoration: BoxDecoration(
        color: colors.surfaceMuted,
        borderRadius: BorderRadius.circular(12),
      ),
      alignment: Alignment.center,
      child: Column(
        children: [
          Icon(icon, size: 18, color: iconColor ?? colors.textSecondary),
          const SizedBox(height: 4),
          Text(
            value,
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}

class GuardianBottomNav extends StatelessWidget {
  const GuardianBottomNav({
    super.key,
    required this.currentIndex,
    required this.onTap,
  });

  final int currentIndex;
  final ValueChanged<int> onTap;

  @override
  Widget build(BuildContext context) {
    return MobileBottomBar(
      currentIndex: currentIndex,
      onTap: onTap,
      onSos: () => onTap(0),
    );
  }
}
