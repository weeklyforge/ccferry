import 'package:flutter/material.dart';

void main() {
  runApp(const CcferryApp());
}

// App shell. Later tasks mount providers and routes here; the smoke test
// pins the exported widget name.
class CcferryApp extends StatelessWidget {
  const CcferryApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'ccferry',
      home: Scaffold(
        body: Center(
          child: Text('ccferry', style: Theme.of(context).textTheme.headlineMedium),
        ),
      ),
    );
  }
}
