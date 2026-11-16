// 1.4.7 hardening: fullscreen state after a refused request, Cast certificate
// scope, and "permission denied" on the party tables meaning "run live".
import 'package:byte/cast/cast_session.dart' show isLanCastHost;
import 'package:byte/data/listen_together.dart' show ListenTogether;
import 'package:byte/ui/app_fullscreen.dart';
import 'package:flutter_test/flutter_test.dart';

class _RefusingWindow implements WindowFullscreen {
  int calls = 0;
  @override
  Future<void> set(bool on) async {
    calls++;
    throw Exception('the platform refused');
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('a refused full-screen request does not leave Byte marked full screen', () async {
    final previous = AppFullscreen.window;
    final refusing = _RefusingWindow();
    AppFullscreen.window = refusing;
    try {
      AppFullscreen.active.value = false;
      await AppFullscreen.enter();
      expect(refusing.calls, 1);
      expect(AppFullscreen.active.value, isFalse);
    } finally {
      AppFullscreen.window = previous;
      AppFullscreen.active.value = false;
    }
  });

  test('a Cast self-signed certificate is trusted only on the home network', () {
    expect(isLanCastHost('192.168.1.40'), isTrue);
    expect(isLanCastHost('10.0.0.7'), isTrue);
    expect(isLanCastHost('172.16.5.9'), isTrue);
    expect(isLanCastHost('172.32.0.1'), isFalse);
    expect(isLanCastHost('169.254.10.2'), isTrue);
    expect(isLanCastHost('127.0.0.1'), isTrue);
    expect(isLanCastHost('fd12:3456::1'), isTrue);
    expect(isLanCastHost('Living-Room.local'), isTrue);
    expect(isLanCastHost('8.8.8.8'), isFalse);
    expect(isLanCastHost('2606:4700::1111'), isFalse);
    expect(isLanCastHost('youtube.com'), isFalse);
  });

  test('a permission error on the party tables means: run the party live', () {
    expect(ListenTogether.isSetupMissing(Exception('PostgrestException(message: permission denied for table byte_listen_rooms, code: 42501)')), isTrue);
    expect(ListenTogether.isSetupMissing(Exception('SocketException: Failed host lookup')), isFalse);
  });
}
