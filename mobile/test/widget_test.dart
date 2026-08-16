import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/main.dart';

void main() {
  testWidgets('ExpenseTrackerApp smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(ExpenseTrackerApp());
    expect(find.text('Travel Expense Tracker'), findsOneWidget);
  });
}
