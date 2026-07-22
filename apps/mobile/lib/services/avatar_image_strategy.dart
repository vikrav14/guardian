import 'package:flutter/foundation.dart';
import 'package:flutter/painting.dart';

import 'avatar_storage_urls.dart';

/// Firebase Storage token URLs can be shown in an HTML `<img>` on web without
/// bucket CORS, but byte fetches (`Image.network` default, `getData()`) use
/// XHR and require CORS. Prefer the HTML-element path for tokenized URLs.
bool shouldPreferWebHtmlElementAvatar(String url) {
  if (!kIsWeb) return false;
  final location = parseFirebaseStorageMediaUrl(url);
  if (location == null) return false;
  final token = location.downloadToken?.trim();
  return token != null && token.isNotEmpty;
}

WebHtmlElementStrategy webHtmlElementStrategyForAvatar(String url) {
  return shouldPreferWebHtmlElementAvatar(url)
      ? WebHtmlElementStrategy.prefer
      : WebHtmlElementStrategy.never;
}

/// Load avatar bytes through the Storage SDK for auth-only Firebase Storage URLs.
bool shouldLoadAvatarBytesViaSdk(String url) {
  if (!isFirebaseStorageMediaUrl(url)) return false;
  final token = parseFirebaseStorageMediaUrl(url)?.downloadToken?.trim();
  return token == null || token.isEmpty;
}
