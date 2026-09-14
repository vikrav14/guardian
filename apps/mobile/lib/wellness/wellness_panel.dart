import 'dart:async';
import 'package:flutter/material.dart';
import '../models/activity_day.dart';
import '../models/wear_status.dart';
import '../services/wear_status_service.dart';
import '../services/guardian_services.dart';
import '../theme/app_theme.dart';
import 'wellness_card.dart';
import 'wellness_history.dart';
import 'wellness_sample.dart';
import 'wellness_window.dart';
import 'wellness_pilot_access.dart';

typedef WellnessReadingsSource =
    Stream<List<WellnessSample>> Function(
      WellnessWindow window,
      GuardianSubscription subscription,
    );

class WellnessPanel extends StatelessWidget {
  const WellnessPanel({
    super.key,
    required this.imei,
    required this.name,
    required this.subscription,
    required this.activityEnabled,
    this.readingsSource,
    this.onAsk,
    this.pilotPreview = false,
  });
  final String imei, name;
  final GuardianSubscription subscription;
  final bool activityEnabled;
  final bool pilotPreview;
  final WellnessReadingsSource? readingsSource;
  final VoidCallback? onAsk;

  @override
  Widget build(BuildContext context) {
    final content = _WellnessData(
      key: ValueKey('$imei:${subscription.plan}:${subscription.accessUntil}'),
      imei: imei,
      subscription: subscription,
      activityEnabled: activityEnabled,
      readingsSource: readingsSource,
      pilotPreview: pilotPreview,
      onOpen: subscription.plan == GuardianPlan.essential
          ? null
          : () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => _WellnessRoute(
                  imei: imei,
                  name: name,
                  activityEnabled: activityEnabled,
                  readingsSource: readingsSource,
                  pilotPreview: pilotPreview,
                  onAsk: onAsk,
                ),
              ),
            ),
    );
    return pilotPreview
        ? WellnessPilotAccess(imei: imei, child: content)
        : content;
  }
}

class _WellnessRoute extends StatefulWidget {
  const _WellnessRoute({
    required this.imei,
    required this.name,
    required this.activityEnabled,
    this.readingsSource,
    this.onAsk,
    this.pilotPreview = false,
  });
  final String imei, name;
  final bool activityEnabled;
  final bool pilotPreview;
  final WellnessReadingsSource? readingsSource;
  final VoidCallback? onAsk;
  @override
  State<_WellnessRoute> createState() => _WellnessRouteState();
}

class _WellnessRouteState extends State<_WellnessRoute> {
  late final Stream<GuardianSubscription> _plans = UserProfileService()
      .watchSubscription();
  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: context.guardianColors.canvas,
    appBar: AppBar(title: Text('${widget.name} · Wellness')),
    body: StreamBuilder<GuardianSubscription>(
      stream: _plans,
      builder: (context, snapshot) {
        final sub = snapshot.data;
        if (snapshot.hasError ||
            sub == null ||
            !sub.serviceActive ||
            sub.plan == GuardianPlan.essential) {
          return const Center(
            child: Padding(
              padding: EdgeInsets.all(24),
              child: Text(
                'Wellness history requires an active Family or Care plan. Today’s readings are on Home.',
              ),
            ),
          );
        }
        final content = SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 900),
              child: _WellnessData(
                key: ValueKey('${sub.plan}:${sub.accessUntil}'),
                imei: widget.imei,
                subscription: sub,
                activityEnabled: widget.activityEnabled,
                readingsSource: widget.readingsSource,
                detail: true,
                pilotPreview: widget.pilotPreview,
                onAsk: widget.onAsk,
              ),
            ),
          ),
        );
        return widget.pilotPreview
            ? WellnessPilotAccess(imei: widget.imei, child: content)
            : content;
      },
    ),
  );
}

class _WellnessData extends StatefulWidget {
  const _WellnessData({
    super.key,
    required this.imei,
    required this.subscription,
    required this.activityEnabled,
    this.readingsSource,
    this.detail = false,
    this.onOpen,
    this.onAsk,
    this.pilotPreview = false,
  });
  final String imei;
  final GuardianSubscription subscription;
  final bool activityEnabled, detail;
  final bool pilotPreview;
  final WellnessReadingsSource? readingsSource;
  final VoidCallback? onOpen, onAsk;
  @override
  State<_WellnessData> createState() => _WellnessDataState();
}

class _WellnessDataState extends State<_WellnessData>
    with WidgetsBindingObserver {
  late DateTime _now;
  DateTime? _before;
  late WellnessWindow _window;
  Stream<List<ActivityDay>>? _days;
  Stream<List<WellnessSample>>? _readings;
  Stream<WearStatus>? _wearStatus;
  Timer? _timer;
  @override
  void initState() {
    super.initState();
    _now = DateTime.now();
    _connect();
    WidgetsBinding.instance.addObserver(this);
    _timer = Timer.periodic(const Duration(seconds: 30), (_) => _tick());
  }

  void _connect() {
    if (!_active) return;
    _wearStatus = WearStatusService().watch(widget.imei);
    _window = WellnessWindow.forSubscription(
      widget.subscription,
      now: _now,
      before: _before,
      days: widget.detail ? 7 : 1,
    );
    _days = widget.activityEnabled
        ? ActivityService().watchRecentDays(
            imei: widget.imei,
            subscription: widget.subscription,
            before: _window.end,
            limit: widget.detail ? 7 : 1,
            pilotPreview: widget.pilotPreview,
          )
        : Stream.value(const []);
    _readings = widget.pilotPreview
        ? WellbeingService().watchWellnessSamples(
            widget.imei,
            subscription: widget.subscription,
            window: _window,
            pilotPreview: true,
          )
        : widget.readingsSource?.call(_window, widget.subscription) ??
              Stream.value(const []);
  }

  bool get _active =>
      widget.subscription.serviceActive &&
      (widget.subscription.accessUntil == null ||
          widget.subscription.accessUntil!.isAfter(_now));
  void _tick() {
    if (!mounted) return;
    setState(() {
      final priorDay = wellnessDateKey(_now);
      _now = DateTime.now();
      if (priorDay != wellnessDateKey(_now)) _connect();
    });
  }

  @override
  void didUpdateWidget(covariant _WellnessData oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.subscription != widget.subscription ||
        oldWidget.imei != widget.imei ||
        oldWidget.activityEnabled != widget.activityEnabled ||
        oldWidget.pilotPreview != widget.pilotPreview ||
        oldWidget.readingsSource != widget.readingsSource) {
      _connect();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _tick();
  }

  @override
  void dispose() {
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  void _move(DateTime end) => setState(() {
    _before = end;
    _connect();
  });
  Future<void> _chooseDate() async {
    final local = _now.toUtc().add(const Duration(hours: 4));
    final chosen = await showDatePicker(
      context: context,
      initialDate: local,
      firstDate: DateTime(2020),
      lastDate: local,
    );
    if (chosen != null && mounted) {
      _move(
        DateTime.utc(
          chosen.year,
          chosen.month,
          chosen.day,
        ).subtract(const Duration(hours: 4)).add(const Duration(days: 1)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_active) {
      return const WellnessSurface(
        child: Text('Guardian service access has ended.'),
      );
    }
    return StreamBuilder<WearStatus>(
      key: ObjectKey(_wearStatus),
      stream: _wearStatus,
      builder: (context, status) => _buildReadings(
        context,
        status.hasError
            ? const WearStatus()
            : status.data ?? const WearStatus(),
      ),
    );
  }

  Widget _buildReadings(BuildContext context, WearStatus wearStatus) {
    // Keys clear cached StreamBuilder data when day, plan, source or window changes.
    return StreamBuilder<List<ActivityDay>>(
      key: ObjectKey(_days),
      stream: _days,
      builder: (context, activity) => StreamBuilder<List<WellnessSample>>(
        key: ObjectKey(_readings),
        stream: _readings,
        builder: (context, readings) {
          final days = activity.hasError
              ? <ActivityDay>[]
              : activity.data ?? <ActivityDay>[];
          final samples = readings.hasError
              ? <WellnessSample>[]
              : readings.data ?? <WellnessSample>[];
          if (!widget.detail) {
            return WellnessCard(
              pilotPreview: widget.pilotPreview,
              wearStatus: wearStatus,
              days: days,
              samples: samples,
              now: _now,
              activityAvailable: widget.activityEnabled,
              readingsAvailable:
                  widget.pilotPreview || widget.readingsSource != null,
              activityError: activity.hasError,
              readingsError: readings.hasError,
              loading:
                  activity.connectionState == ConnectionState.waiting ||
                  readings.connectionState == ConnectionState.waiting,
              onOpen: widget.onOpen,
            );
          }
          final care = widget.subscription.plan == GuardianPlan.care;
          final tomorrow = wellnessDayStart(_now).add(const Duration(days: 1));
          return WellnessHistory(
            pilotPreview: widget.pilotPreview,
            window: _window,
            days: days,
            samples: samples,
            now: _now,
            activityAvailable: widget.activityEnabled,
            readingsAvailable:
                widget.pilotPreview || widget.readingsSource != null,
            activityError: activity.hasError,
            readingError: readings.hasError,
            onPrevious: care ? () => _move(_window.start) : null,
            onNext: care && _window.end.isBefore(tomorrow)
                ? () => _move(_window.end.add(const Duration(days: 7)))
                : null,
            onChooseDate: care ? _chooseDate : null,
            onAsk:
                !widget.pilotPreview &&
                    widget.subscription.has(
                      GuardianFeature.whatsappQuestionsAnswers,
                    )
                ? widget.onAsk
                : null,
          );
        },
      ),
    );
  }
}
