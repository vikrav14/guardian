import 'contacts_page.dart';

/// Compatibility route for earlier watch-contact links.
class WatchContactsPage extends ContactsPage {
  const WatchContactsPage({super.key, required super.imei, required super.wearerName, super.service});
}
