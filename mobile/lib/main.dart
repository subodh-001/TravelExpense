// ============================================================
// COMPLETE FLUTTER APP - main.dart
// Monthly Travel Expense Tracker (Apple Liquid Glass UI)
// ============================================================

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'dart:io';

void main() => runApp(ExpenseTrackerApp());

class ExpenseTrackerApp extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Expense Tracker',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        scaffoldBackgroundColor: const Color(0xFFFAFAFC),
        colorScheme: ColorScheme.fromSeed(
          seedColor: Colors.black,
          primary: Colors.black,
          brightness: Brightness.light,
        ),
      ),
      home: ExpenseListScreen(),
    );
  }
}

// ==================== MODELS ====================
class Expense {
  final String id;
  final String date;
  final String location;
  final List<Entry> entries;
  final double total;
  List<Receipt> receipts;

  Expense({
    required this.id,
    required this.date,
    required this.location,
    required this.entries,
    required this.total,
    this.receipts = const [],
  });

  factory Expense.fromJson(Map<String, dynamic> json) {
    return Expense(
      id: json['id'] ?? json['_id'] ?? '',
      date: json['date'] ?? '',
      location: json['location'] ?? '',
      entries: (json['entries'] as List? ?? [])
          .map((e) => Entry.fromJson(e))
          .toList(),
      total: (json['total'] as num? ?? 0.0).toDouble(),
      receipts: (json['receipts'] as List? ?? [])
          .map((r) => Receipt.fromJson(r))
          .toList(),
    );
  }
}

class Entry {
  String type;
  double amount;

  Entry({required this.type, required this.amount});

  factory Entry.fromJson(Map<String, dynamic> json) {
    return Entry(
      type: json['type'] ?? 'Other',
      amount: (json['amount'] as num? ?? 0.0).toDouble(),
    );
  }

  Map<String, dynamic> toJson() => {'type': type, 'amount': amount};
}

class Receipt {
  final String fileName;
  final String fileUrl;
  final DateTime uploadedAt;

  Receipt({
    required this.fileName,
    required this.fileUrl,
    required this.uploadedAt,
  });

  factory Receipt.fromJson(dynamic json) {
    if (json is String) {
      return Receipt(
        fileName: 'Receipt Photo',
        fileUrl: json,
        uploadedAt: DateTime.now(),
      );
    }
    if (json is Map<String, dynamic>) {
      return Receipt(
        fileName: json['fileName'] ?? json['originalName'] ?? 'receipt',
        fileUrl: json['fileUrl'] ?? json['url'] ?? '',
        uploadedAt: json['uploadedAt'] != null
            ? DateTime.tryParse(json['uploadedAt'].toString()) ?? DateTime.now()
            : DateTime.now(),
      );
    }
    return Receipt(fileName: 'receipt', fileUrl: '', uploadedAt: DateTime.now());
  }
}

// ==================== API SERVICE ====================
class ApiService {
  // Preset Endpoints
  static const String RENDER_URL = 'https://travelexpense-52gp.onrender.com/api';
  static const String EMULATOR_URL = 'http://10.0.2.2:3000/api';
  static const String LOCALHOST_URL = 'http://localhost:3000/api';

  // Active Base URL & User ID
  static String baseUrl = RENDER_URL;
  static String userId = 'google_subodh';
  static const Duration timeoutDuration = Duration(seconds: 12);

  static Future<List<Expense>> getExpenses() async {
    try {
      final response = await http
          .get(
            Uri.parse('$baseUrl/expenses'),
            headers: {'user-id': userId},
          )
          .timeout(timeoutDuration);

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        return (data['expenses'] as List)
            .map((e) => Expense.fromJson(e))
            .toList();
      } else {
        throw Exception('Server returned ${response.statusCode}');
      }
    } catch (e) {
      throw Exception(_formatError(e));
    }
  }

  static Future<Expense> createExpense(Expense expense) async {
    try {
      final response = await http
          .post(
            Uri.parse('$baseUrl/expenses'),
            headers: {
              'Content-Type': 'application/json',
              'user-id': userId,
            },
            body: json.encode({
              'date': expense.date,
              'location': expense.location,
              'entries': expense.entries.map((e) => e.toJson()).toList(),
            }),
          )
          .timeout(timeoutDuration);

      if (response.statusCode == 201) {
        final data = json.decode(response.body);
        return Expense.fromJson(data['data']);
      } else {
        throw Exception('Server returned ${response.statusCode}');
      }
    } catch (e) {
      throw Exception(_formatError(e));
    }
  }

  static Future<Receipt> uploadReceipt(String expenseId, File file) async {
    try {
      var request = http.MultipartRequest(
        'POST',
        Uri.parse('$baseUrl/expenses/$expenseId/receipts'),
      );

      request.headers['user-id'] = userId;
      request.files.add(await http.MultipartFile.fromPath('receipt', file.path));

      final streamedResponse = await request.send().timeout(timeoutDuration);
      final responseBody = await streamedResponse.stream.bytesToString();
      final data = json.decode(responseBody);

      if (streamedResponse.statusCode == 200) {
        return Receipt.fromJson(data['receipt']);
      } else {
        throw Exception(data['error'] ?? 'Failed to upload receipt');
      }
    } catch (e) {
      throw Exception(_formatError(e));
    }
  }

  static Future<void> deleteExpense(String expenseId) async {
    try {
      final response = await http
          .delete(
            Uri.parse('$baseUrl/expenses/$expenseId'),
            headers: {'user-id': userId},
          )
          .timeout(timeoutDuration);

      if (response.statusCode != 200) {
        throw Exception('Failed to delete expense');
      }
    } catch (e) {
      throw Exception(_formatError(e));
    }
  }

  static String _formatError(dynamic e) {
    String msg = e.toString();
    if (msg.contains('TimeoutException')) {
      return 'Server timeout ($baseUrl). If using local server, switch endpoint to Emulator (10.0.2.2) or local IP.';
    } else if (msg.contains('SocketException') || msg.contains('Connection refused')) {
      return 'Cannot reach $baseUrl. Make sure server is running via ./start.sh or select correct server mode.';
    }
    return msg.replaceAll('Exception: ', '');
  }
}

// ==================== SCREENS ====================

// ---- EXPENSE LIST SCREEN ----
class ExpenseListScreen extends StatefulWidget {
  @override
  _ExpenseListScreenState createState() => _ExpenseListScreenState();
}

class _ExpenseListScreenState extends State<ExpenseListScreen> {
  List<Expense> _expenses = [];
  bool _loading = true;
  String? _errorMessage;

  static const Color appleGrayCard = Color(0xFFF4F4F7);

  @override
  void initState() {
    super.initState();
    _loadExpenses();
  }

  Future<void> _loadExpenses() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });
    try {
      final expenses = await ApiService.getExpenses();
      setState(() {
        _expenses = expenses;
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _loading = false;
        _errorMessage = e.toString().replaceAll('Exception: ', '');
      });
    }
  }

  void _showServerSettings() {
    final customIpController = TextEditingController(
      text: ApiService.baseUrl.contains('http') &&
              !ApiService.baseUrl.contains('onrender.com') &&
              !ApiService.baseUrl.contains('10.0.2.2') &&
              !ApiService.baseUrl.contains('localhost')
          ? ApiService.baseUrl
          : '',
    );
    final userIdController = TextEditingController(text: ApiService.userId);

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            return Padding(
              padding: EdgeInsets.only(
                top: 20,
                left: 20,
                right: 20,
                bottom: MediaQuery.of(context).viewInsets.bottom + 20,
              ),
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text(
                          '⚙️ Backend Server Settings',
                          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
                        ),
                        IconButton(
                          icon: const Icon(Icons.close),
                          onPressed: () => Navigator.pop(context),
                        )
                      ],
                    ),
                    const SizedBox(height: 12),
                    const Text('Select Backend Endpoint:',
                        style: TextStyle(fontWeight: FontWeight.w600)),
                    const SizedBox(height: 8),
                    ListTile(
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      tileColor: ApiService.baseUrl == ApiService.RENDER_URL
                          ? appleGrayCard
                          : Colors.grey.shade100,
                      leading: Icon(Icons.cloud_done,
                          color: ApiService.baseUrl == ApiService.RENDER_URL
                              ? Colors.black
                              : Colors.grey),
                      title: const Text('Render Live Server'),
                      subtitle: Text(ApiService.RENDER_URL, style: const TextStyle(fontSize: 12)),
                      trailing: ApiService.baseUrl == ApiService.RENDER_URL
                          ? const Icon(Icons.check_circle, color: Colors.black)
                          : null,
                      onTap: () {
                        setState(() => ApiService.baseUrl = ApiService.RENDER_URL);
                        setModalState(() {});
                      },
                    ),
                    const SizedBox(height: 8),
                    ListTile(
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      tileColor: ApiService.baseUrl == ApiService.EMULATOR_URL
                          ? appleGrayCard
                          : Colors.grey.shade100,
                      leading: Icon(Icons.phone_android,
                          color: ApiService.baseUrl == ApiService.EMULATOR_URL
                              ? Colors.black
                              : Colors.grey),
                      title: const Text('Android Emulator (10.0.2.2)'),
                      subtitle: Text(ApiService.EMULATOR_URL, style: const TextStyle(fontSize: 12)),
                      trailing: ApiService.baseUrl == ApiService.EMULATOR_URL
                          ? const Icon(Icons.check_circle, color: Colors.black)
                          : null,
                      onTap: () {
                        setState(() => ApiService.baseUrl = ApiService.EMULATOR_URL);
                        setModalState(() {});
                      },
                    ),
                    const SizedBox(height: 8),
                    ListTile(
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      tileColor: ApiService.baseUrl == ApiService.LOCALHOST_URL
                          ? appleGrayCard
                          : Colors.grey.shade100,
                      leading: Icon(Icons.computer,
                          color: ApiService.baseUrl == ApiService.LOCALHOST_URL
                              ? Colors.black
                              : Colors.grey),
                      title: const Text('Local Web / Localhost (3000)'),
                      subtitle: Text(ApiService.LOCALHOST_URL, style: const TextStyle(fontSize: 12)),
                      trailing: ApiService.baseUrl == ApiService.LOCALHOST_URL
                          ? const Icon(Icons.check_circle, color: Colors.black)
                          : null,
                      onTap: () {
                        setState(() => ApiService.baseUrl = ApiService.LOCALHOST_URL);
                        setModalState(() {});
                      },
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: customIpController,
                      decoration: const InputDecoration(
                        labelText: 'Custom Server URL (e.g. http://192.168.1.5:3000/api)',
                        border: OutlineInputBorder(),
                        prefixIcon: Icon(Icons.link),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: userIdController,
                      decoration: const InputDecoration(
                        labelText: 'User ID Header',
                        border: OutlineInputBorder(),
                        prefixIcon: Icon(Icons.person),
                      ),
                    ),
                    const SizedBox(height: 16),
                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.black,
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
                        ),
                        onPressed: () {
                          if (customIpController.text.trim().isNotEmpty) {
                            ApiService.baseUrl = customIpController.text.trim();
                          }
                          if (userIdController.text.trim().isNotEmpty) {
                            ApiService.userId = userIdController.text.trim();
                          }
                          Navigator.pop(context);
                          _loadExpenses();
                        },
                        child: const Text('Save & Reconnect',
                            style: TextStyle(fontWeight: FontWeight.bold)),
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Travel Expense Log', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.black)),
            Text('Server: ${ApiService.baseUrl}',
                style: const TextStyle(fontSize: 11, color: Colors.grey),
                overflow: TextOverflow.ellipsis),
          ],
        ),
        elevation: 0,
        backgroundColor: Colors.white,
        foregroundColor: Colors.black,
        actions: [
          IconButton(
            icon: const Icon(Icons.settings, color: Colors.black),
            tooltip: 'Server Settings',
            onPressed: _showServerSettings,
          ),
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.black),
            tooltip: 'Refresh',
            onPressed: _loadExpenses,
          )
        ],
      ),
      body: _loading
          ? const Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  CircularProgressIndicator(color: Colors.black),
                  SizedBox(height: 16),
                  Text('Loading expenses...', style: TextStyle(color: Colors.grey)),
                ],
              ),
            )
          : _errorMessage != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(Icons.wifi_off_rounded, size: 70, color: Colors.black),
                        const SizedBox(height: 16),
                        const Text(
                          'Connection Failed',
                          style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          _errorMessage!,
                          textAlign: TextAlign.center,
                          style: const TextStyle(color: Colors.grey),
                        ),
                        const SizedBox(height: 20),
                        ElevatedButton.icon(
                          onPressed: _showServerSettings,
                          icon: const Icon(Icons.settings),
                          label: const Text('Change Server / Switch to Local'),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.black,
                            foregroundColor: Colors.white,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
                          ),
                        ),
                        const SizedBox(height: 8),
                        TextButton.icon(
                          onPressed: _loadExpenses,
                          icon: const Icon(Icons.refresh, color: Colors.black),
                          label: const Text('Retry', style: TextStyle(color: Colors.black)),
                        ),
                      ],
                    ),
                  ),
                )
              : _expenses.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Icon(Icons.receipt_long_outlined, size: 80, color: Colors.grey),
                          const SizedBox(height: 16),
                          const Text(
                            'No travel expenses yet!',
                            style: TextStyle(fontSize: 18, color: Colors.grey, fontWeight: FontWeight.bold),
                          ),
                          const SizedBox(height: 8),
                          const Text(
                            'Tap + button to record a new travel entry',
                            style: TextStyle(fontSize: 14, color: Colors.grey),
                          ),
                        ],
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _loadExpenses,
                      color: Colors.black,
                      child: ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: _expenses.length,
                        itemBuilder: (context, index) {
                          final expense = _expenses[index];
                          return Container(
                            margin: const EdgeInsets.only(bottom: 12),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(22),
                              border: Border.all(color: const Color(0xFFE5E5EA)),
                            ),
                            child: ListTile(
                              contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                              leading: CircleAvatar(
                                backgroundColor: appleGrayCard,
                                child: const Icon(Icons.directions_car, color: Colors.black),
                              ),
                              title: Text(
                                expense.location,
                                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                              ),
                              subtitle: Padding(
                                padding: const EdgeInsets.only(top: 4),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text('Date: ${expense.date}', style: const TextStyle(fontSize: 13, color: Colors.grey)),
                                    Text('Receipts: ${expense.receipts.length}', style: const TextStyle(fontSize: 13, color: Colors.black)),
                                  ],
                                ),
                              ),
                              trailing: Text(
                                '₹${expense.total.toStringAsFixed(0)}',
                                style: const TextStyle(
                                  fontWeight: FontWeight.bold,
                                  fontSize: 18,
                                  color: Colors.black,
                                ),
                              ),
                              onTap: () {
                                Navigator.push(
                                  context,
                                  MaterialPageRoute(
                                    builder: (_) => ExpenseDetailScreen(expense: expense),
                                  ),
                                ).then((_) => _loadExpenses());
                              },
                            ),
                          );
                        },
                      ),
                    ),
      floatingActionButton: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(30),
          gradient: const LinearGradient(
            colors: [Color(0xFFFFC3D0), Color(0xFFE3D5FA), Color(0xFFCBDDF9)],
          ),
        ),
        padding: const EdgeInsets.all(4),
        child: FloatingActionButton.extended(
          onPressed: () {
            Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => AddExpenseScreen()),
            ).then((_) => _loadExpenses());
          },
          label: const Text('Add Entry', style: TextStyle(fontWeight: FontWeight.bold)),
          icon: const Icon(Icons.add),
          backgroundColor: Colors.black,
          foregroundColor: Colors.white,
        ),
      ),
    );
  }
}

// ---- ADD EXPENSE SCREEN ----
class AddExpenseScreen extends StatefulWidget {
  @override
  _AddExpenseScreenState createState() => _AddExpenseScreenState();
}

class _AddExpenseScreenState extends State<AddExpenseScreen> {
  final _formKey = GlobalKey<FormState>();
  final _dateController = TextEditingController();
  final _locationController = TextEditingController();
  final List<Entry> _entries = [
    Entry(type: 'Metro', amount: 0),
    Entry(type: 'Local', amount: 0),
    Entry(type: 'Auto/Rapido', amount: 0),
    Entry(type: 'Others', amount: 0),
  ];
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _dateController.text = _getTodayDate();
  }

  String _getTodayDate() {
    final now = DateTime.now();
    return '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
  }

  Future<void> _saveExpense() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _loading = true);

    try {
      final expense = Expense(
        id: '',
        date: _dateController.text,
        location: _locationController.text,
        entries: _entries,
        total: _entries.fold(0.0, (sum, e) => sum + e.amount),
      );

      await ApiService.createExpense(expense);
      Navigator.pop(context, true);
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error saving: $e')),
      );
    } finally {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    double grandTotal = _entries.fold(0.0, (sum, e) => sum + e.amount);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Add Travel Expense'),
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
      ),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            children: [
              TextFormField(
                controller: _dateController,
                decoration: const InputDecoration(
                  labelText: 'Date (YYYY-MM-DD)',
                  border: OutlineInputBorder(),
                  prefixIcon: Icon(Icons.calendar_today),
                ),
                validator: (v) => v!.isEmpty ? 'Enter date' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _locationController,
                decoration: const InputDecoration(
                  labelText: 'Location / Destination',
                  border: OutlineInputBorder(),
                  prefixIcon: Icon(Icons.location_on),
                ),
                validator: (v) => v!.isEmpty ? 'Enter location' : null,
              ),
              const SizedBox(height: 16),
              const Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  'Transportation Amounts (₹):',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                ),
              ),
              const SizedBox(height: 8),
              Expanded(
                child: ListView.builder(
                  itemCount: _entries.length,
                  itemBuilder: (context, index) {
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: Row(
                        children: [
                          Expanded(
                            flex: 2,
                            child: Text(
                              _entries[index].type,
                              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
                            ),
                          ),
                          Expanded(
                            flex: 2,
                            child: TextFormField(
                              initialValue: _entries[index].amount == 0
                                  ? ''
                                  : _entries[index].amount.toString(),
                              keyboardType: TextInputType.number,
                              decoration: const InputDecoration(
                                border: OutlineInputBorder(),
                                prefixIcon: Icon(Icons.currency_rupee, size: 16),
                                hintText: '0',
                              ),
                              onChanged: (value) {
                                setState(() {
                                  _entries[index].amount = double.tryParse(value) ?? 0;
                                });
                              },
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
              ),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFF4F4F7),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFFE5E5EA)),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Total Expense:', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                    Text(
                      '₹${grandTotal.toStringAsFixed(0)}',
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 20, color: Colors.black),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _loading ? null : _saveExpense,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.black,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(26)),
                  ),
                  child: _loading
                      ? const CircularProgressIndicator(color: Colors.white)
                      : const Text('Save Expense', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ---- EXPENSE DETAIL SCREEN ----
class ExpenseDetailScreen extends StatefulWidget {
  final Expense expense;

  ExpenseDetailScreen({required this.expense});

  @override
  _ExpenseDetailScreenState createState() => _ExpenseDetailScreenState();
}

class _ExpenseDetailScreenState extends State<ExpenseDetailScreen> {
  bool _loading = false;

  Future<void> _uploadReceipt() async {
    try {
      final picker = ImagePicker();
      final result = await picker.pickImage(source: ImageSource.gallery);

      if (result == null) return;

      setState(() => _loading = true);

      final file = File(result.path);
      await ApiService.uploadReceipt(widget.expense.id, file);

      final updatedExpenses = await ApiService.getExpenses();
      final updatedExpense = updatedExpenses.firstWhere(
        (e) => e.id == widget.expense.id,
      );

      setState(() {
        widget.expense.receipts = updatedExpense.receipts;
        _loading = false;
      });

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('✅ Receipt uploaded successfully!')),
      );
    } catch (e) {
      setState(() => _loading = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Upload Note: $e')),
      );
    }
  }

  Future<void> _deleteExpense() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Delete Expense?'),
        content: const Text('This will delete all associated receipts as well.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );

    if (confirm == true) {
      setState(() => _loading = true);
      try {
        await ApiService.deleteExpense(widget.expense.id);
        Navigator.pop(context, true);
      } catch (e) {
        setState(() => _loading = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final expense = widget.expense;

    return Scaffold(
      appBar: AppBar(
        title: Text(expense.location),
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            icon: const Icon(Icons.delete_outline),
            onPressed: _deleteExpense,
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Card(
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              elevation: 2,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Date:', style: TextStyle(fontWeight: FontWeight.bold)),
                        Text(expense.date),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Location:', style: TextStyle(fontWeight: FontWeight.bold)),
                        Text(expense.location),
                      ],
                    ),
                    const Divider(height: 20),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Total Expense:', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                        Text(
                          '₹${expense.total.toStringAsFixed(0)}',
                          style: const TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 20,
                            color: Colors.black,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            const Text(
              '📊 Expense Breakdown',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
            ),
            const SizedBox(height: 8),
            ...expense.entries.map((entry) {
              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(entry.type, style: const TextStyle(fontSize: 15)),
                    Text('₹${entry.amount.toStringAsFixed(0)}', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                  ],
                ),
              );
            }),
            const SizedBox(height: 20),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  '📎 Attached Receipts (${expense.receipts.length})',
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                ),
                ElevatedButton.icon(
                  onPressed: _loading ? null : _uploadReceipt,
                  icon: const Icon(Icons.upload_file, size: 16),
                  label: const Text('Upload Receipt'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.black,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            if (expense.receipts.isEmpty)
              const Center(
                child: Padding(
                  padding: EdgeInsets.all(24),
                  child: Text(
                    'No receipts uploaded for this expense',
                    style: TextStyle(color: Colors.grey),
                  ),
                ),
              )
            else
              Expanded(
                child: ListView.builder(
                  itemCount: expense.receipts.length,
                  itemBuilder: (context, index) {
                    final receipt = expense.receipts[index];
                    return Card(
                      child: ListTile(
                        leading: const Icon(Icons.insert_drive_file, color: Colors.black),
                        title: Text(receipt.fileName),
                        subtitle: Text(
                          'Uploaded: ${receipt.uploadedAt.toString().substring(0, 10)}',
                        ),
                        trailing: const Icon(Icons.open_in_new, size: 18),
                      ),
                    );
                  },
                ),
              ),
          ],
        ),
      ),
    );
  }
}
