import os
import re

def fix_membership_list():
    path = r'frontend\src\pages\MembershipList.jsx'
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Replace the handleConfirmDelete block
    old_block = """  const handleConfirmDelete = async () => {
    if (!deleteDialog) return;
    const reason = deleteReason.trim();
    if (!reason) {
      showToast('Please enter a reason for deleting this member.', 'error');
      return;
    }"""
    new_block = """  const handleConfirmDelete = async () => {
    if (!deleteDialog) return;
    const reason = 'Deleted via UI';"""
    content = content.replace(old_block, new_block)

    # 2. Remove textarea
    textarea_regex = re.compile(r'<textarea\s+value=\{deleteReason\}.*?/>', re.DOTALL)
    content = textarea_regex.sub('', content)

    # 3. Remove disabled condition
    content = content.replace(
        "disabled={!hasPermission('members.delete') || !deleteReason.trim()}",
        "disabled={!hasPermission('members.delete')}"
    )

    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

if __name__ == '__main__':
    fix_membership_list()
