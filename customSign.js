// Custom signing script - تجاهل التوقيع الفعلي
// Skip actual code signing

module.exports = async function(configuration) {
  console.log('تم تخطي التوقيع الرقمي - Skipping code signing');
  return {};
};
