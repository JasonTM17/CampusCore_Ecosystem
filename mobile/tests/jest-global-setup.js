// Snapshots and date copy are rendered in the campus time zone; pin it so a runner in UTC renders the same text.
module.exports = async () => {
  process.env.TZ = 'Asia/Ho_Chi_Minh';
};
