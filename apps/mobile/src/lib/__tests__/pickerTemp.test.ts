/** Cópias em claro que os seletores deixam no cache (auditoria 2026-11-09): só elas podem ser apagadas. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPickerTemp, PICKER_CACHE_DIRS } from '../pickerTemp';

const ANDROID = 'file:///data/user/0/com.piu/cache/';
const IOS = 'file:///var/mobile/Containers/Data/Application/AB/Library/Caches/';

test('cópias dos seletores no cache do app são temporárias', () => {
  assert.ok(isPickerTemp(`${ANDROID}ImagePicker/a.jpg`, ANDROID));
  assert.ok(isPickerTemp(`${ANDROID}DocumentPicker/b.pdf`, ANDROID));
  assert.ok(isPickerTemp(`${ANDROID}ImageManipulator/c.jpg`, ANDROID.slice(0, -1)));
  // iPhone às vezes devolve /private/var no lugar de /var
  assert.ok(isPickerTemp('file:///private/var/mobile/Containers/Data/Application/AB/Library/Caches/ImagePicker/d.jpg', IOS));
});

test('nunca marca o arquivo original da pessoa nem outras pastas', () => {
  assert.ok(!isPickerTemp('content://media/external/images/1', ANDROID));
  assert.ok(!isPickerTemp('file:///storage/emulated/0/DCIM/Camera/x.jpg', ANDROID));
  assert.ok(!isPickerTemp(`${ANDROID}outra/x.jpg`, ANDROID));
  assert.ok(!isPickerTemp(`${ANDROID}ImagePicker/../../files/x`, ANDROID));
  assert.ok(!isPickerTemp(`${ANDROID}ImagePickerX/x.jpg`, ANDROID));
  assert.ok(!isPickerTemp('blob:http://localhost/1', ANDROID));
  assert.ok(!isPickerTemp(`${ANDROID}ImagePicker/a.jpg`, ''));
});

test('pastas limpas ao apagar os dados locais', () => {
  assert.deepEqual([...PICKER_CACHE_DIRS].sort(), ['DocumentPicker', 'ImageManipulator', 'ImagePicker', 'recebidos']);
});
